import { Store } from "@/app/types";
import { stores } from "@/assets/data/stores";
import Fuse, { FuseResult } from "fuse.js";
import { NextRequest, NextResponse } from "next/server";

const nameFuseOptions = {
  keys: ["name"],
  includeScore: true,
  threshold: 0.4,
};

const addressFuseOptions = {
  keys: ["address"],
  includeScore: true,
  threshold: 0.2,
};

const nameFuse = new Fuse(stores, nameFuseOptions);
const addressFuse = new Fuse(stores, addressFuseOptions);

// 주소에서 "구" 정보 추출하는 함수
function extractDistrict(address: string): string | null {
  const districts = ["수정구", "중원구", "분당구"]; // 성남시 구 목록
  for (const district of districts) {
    if (address.includes(district)) {
      return district;
    }
  }
  return null; // 구 정보가 없으면 null 반환
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const inputText = body.content;
    const responseType = body.type;

    if (!inputText) {
      return NextResponse.json(
        { success: false, message: "입력 텍스트가 없습니다." },
        { status: 400 }
      );
    }

    if (stores.length === 0) {
      return NextResponse.json(
        { success: false, message: "데이터를 불러오는데 실패했습니다." },
        { status: 404 }
      );
    }

    const inputLines = inputText.split("\n");

    console.log("inputLines", inputLines);

    let inputName = "";
    let inputAddress = "";

    for (const line of inputLines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith("[") && trimmedLine.endsWith("]")) {
        continue;
      } else if (trimmedLine.startsWith("https://")) {
        continue;
      } else if (trimmedLine) {
        if (!inputName) {
          inputName = trimmedLine;
        } else {
          inputAddress += trimmedLine + " ";
        }
      }
    }
    inputAddress = inputAddress.replace("경기 성남시", "");
    inputAddress = inputAddress.trim();

    console.log("inputName", inputName);
    console.log("inputAddress", inputAddress);

    let matchedStores: Store[] = [];
    let nameSearchResults: FuseResult<Store>[] = [];
    let addressSearchResults: FuseResult<Store>[] = [];

    if (inputName) {
      nameSearchResults = nameFuse.search(inputName);
    }
    if (inputAddress) {
      addressSearchResults = addressFuse.search(inputAddress);

      const inputDistrict = extractDistrict(inputAddress);
      if (inputDistrict) {
        addressSearchResults = addressSearchResults.filter((result) => {
          const storeDistrict = extractDistrict(result.item.address);
          return storeDistrict === inputDistrict;
        });
      }
    }

    // **[NEW] AND 조건 적용 로직**: 이름과 주소가 모두 입력된 경우에만 AND 조건 적용
    if (inputName && inputAddress) {
      // 이름 검색 결과와 주소 검색 결과를 "교집합" 연산 (AND 조건)
      matchedStores = nameSearchResults
        .map((nameResult) => nameResult.item) // 이름 검색 결과에서 Store 객체 추출
        .filter(
          (nameStore) =>
            addressSearchResults.some(
              (addressResult) => addressResult.item === nameStore
            ) // 주소 검색 결과에도 동일한 Store 객체가 있는지 확인
        );
    } else {
      // 이름 또는 주소 중 하나만 입력된 경우 (OR 조건 - 기존 로직 유지)
      matchedStores = [
        ...nameSearchResults.map((result) => result.item),
        ...addressSearchResults.map((result) => result.item),
      ];
      matchedStores = [...new Set(matchedStores)]; // 중복 제거
    }

    let responseData; // 응답 데이터를 담을 변수

    if (matchedStores.length > 0) {
      if (matchedStores.length === 1) {
        responseData = {
          success: true,
          message: "가맹점을 찾았습니다.",
          isDefinitiveMatch: true,
          matchType: "definitive",
          stores: matchedStores.map((store) => ({
            name: store.name,
            category: store.category,
            address: store.address,
          })),
        };
      } else {
        responseData = {
          success: true,
          message: `여러 가맹점을 찾았습니다. 목록에서 확인해주세요. (총 ${matchedStores.length}곳)`,
          isDefinitiveMatch: false,
          matchType: "ambiguous",
          stores: matchedStores.slice(0, 5).map((store) => ({
            name: store.name,
            category: store.category,
            address: store.address,
          })),
        };
      }
    } else {
      responseData = {
        success: true,
        isDefinitiveMatch: false,
        matchType: "none",
        message: "성남시 아동수당 가맹점을 찾을 수 없습니다.",
        stores: [],
      };
    }

    // 텍스트 UI 응답 여부 확인 (query parameter 또는 body에서 type=text 확인)
    const useTextUI = responseType === "text"; // 또는 req.body 에서 확인

    if (useTextUI) {
      const textResponse = createTextUIResponse(responseData);
      return new NextResponse(textResponse, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }); // text/plain 응답
    } else {
      // 기존 JSON 응답
      return NextResponse.json(responseData);
    }
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { success: false, message: "API 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

function createTextUIResponse(responseData: any): string {
  const { isDefinitiveMatch, matchType, stores, message } = responseData;
  let textResponse = "";

  if (matchType === "definitive") {
    const store = stores[0];
    textResponse = `✅ 성남시 아동수당 가맹점입니다\n\n⭐ ${store.name} (${store.category})\n📍 ${store.address}`;
  } else if (matchType === "ambiguous") {
    textResponse = `🤔 여러 가맹점이 검색되었습니다 (${stores.length}곳)\n\n`;
    stores.forEach((store, index) => {
      textResponse += `${index + 1}. ${store.name} (${store.category})\n   📍 ${
        store.address
      }\n`;
    });
    textResponse += `\n목록에서 확인해보셔야 합니다.`;
  } else if (matchType === "none") {
    textResponse = `❌ 가맹점을 찾을 수 없습니다.\n\n성남시 아동수당 가맹점이 아니거나, 등록되지 않은 가게입니다.`;
  } else {
    textResponse = message; // 기본 메시지 또는 에러 메시지
  }
  return textResponse;
}
