import { Store } from "@/app/types";
import { stores } from "@/assets/data/stores";
import Fuse, { FuseResult } from "fuse.js";
import { NextRequest, NextResponse } from "next/server";

const nameFuseOptions = {
  keys: ["name"],
  includeScore: true,
  threshold: 0.2,
};

const addressFuseOptions = {
  keys: ["address"],
  includeScore: true,
  threshold: 0.1,
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

export async function GET(req: NextRequest, res: NextResponse) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query");

  if (!query) {
    return NextResponse.json(
      { error: "쿼리 파라미터가 필요합니다." },
      { status: 400 }
    );
  }

  const found = searchEntries(stores, query);

  return NextResponse.json({ results: found });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const inputText = body.content;

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
    inputAddress = inputAddress.trim();

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

    if (matchedStores.length > 0) {
      return NextResponse.json({
        success: true,
        message: "가맹점을 찾았습니다.",
        stores: matchedStores,
      });
    } else {
      return NextResponse.json(
        { success: false, message: "가맹점을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { success: false, message: "API 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
