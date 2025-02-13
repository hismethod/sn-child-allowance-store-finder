import { Index } from "@upstash/vector";
import OpenAI from "openai";
import { NextResponse, NextRequest } from "next/server";

interface ApiResponse {
  success: boolean;
  isAffiliated: boolean;
  matchType: "definitive" | "ambiguous" | "none";
  message: string;
  stores: StoreResult[]; // StoreResult 배열로 변경
  score: number | null;
}

interface StoreResult {
  name: string;
  category: string;
  address: string;
  similarityScore: number;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const db = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN,
});

async function getEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("임베딩 생성 오류:", error);
    return null;
  }
}

function createTextUIResponse(responseData: ApiResponse): string {
  // ApiResponse 타입 적용
  const { matchType, stores, message, score } = responseData; // stores, score 타입 변경
  let textResponse = "";

  if (matchType === "definitive") {
    const store = stores[0]; // stores 배열에서 store 추출
    textResponse = `✅ 성남시 아동수당 가맹점입니다 (유사도: ${(
      score || 0 * 100
    ).toFixed(0)}%)\n\n⭐ ${store.name} (${store.category})\n📍 ${
      store.address
    }`;
  } else if (matchType === "ambiguous") {
    textResponse = `🤔 여러 가맹점이 검색되었습니다 (${stores.length}곳)\n\n`;
    stores.forEach((store, index) => {
      textResponse += `${index + 1}. ${store.name} (${store.category})\n   📍 ${
        store.address
      } (유사도: ${(store.similarityScore * 100).toFixed(0)}%)\n`; // stores 요소에 유사도 추가
    });
    textResponse += `\n목록에서 확인해보셔야 합니다.`;
  } else if (matchType === "none") {
    textResponse = `❌ 가맹점을 찾을 수 없습니다.\n\n성남시 아동수당 가맹점이 아니거나, 등록되지 않은 가게입니다.`;
  } else {
    textResponse = message;
  }
  return textResponse;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = body.content;
    const responseType = body.type;
    const searchMode = (body.searchMode as "strict" | "wide") || "strict";

    let address = "";
    let storeName = "";

    if (typeof input === "string") {
      if (input.startsWith("[네이버 지도]")) {
        const lines = input.split("\n");
        storeName = lines[1].trim();
        address = lines[2].trim().replace("경기 성남시 ", "");
      } else if (input.startsWith("[카카오맵]")) {
        const lines = input.split("\n");
        storeName = lines[1].trim();
        address = lines[2].trim().replace("경기 성남시 ", "");
      } else {
        address = input.trim().replace("경기 성남시 ", "");
      }
    }

    if (!address && !storeName) {
      return NextResponse.json(
        { message: "잘못된 입력입니다." },
        { status: 400 }
      );
    }

    const inputDescription = storeName
      ? `${storeName} 주소는 ${address}`
      : `"" 주소는 ${address}`;
    const inputDescriptionEmbedding = await getEmbedding(inputDescription);

    if (!inputDescriptionEmbedding) {
      return NextResponse.json(
        { message: "임베딩 생성 실패" },
        { status: 500 }
      );
    }

    const topK = searchMode === "wide" ? 3 : 1; // **[NEW] searchMode에 따라 임계값 동적 설정**
    const searchResults = await db.query({
      topK: topK,
      vector: inputDescriptionEmbedding,
      includeMetadata: true,
      includeVectors: false,
    });

    const matchedStores: any[] = [];

    for (const result of searchResults) {
      let similarityScore = result.score;

      if (!storeName && address) {
        similarityScore = result.score * 0.7;
      }

      matchedStores.push({
        ...result.metadata,
        score: similarityScore,
      });
    }

    let responseData: ApiResponse; // ApiResponse 타입 명시

    let threshold = 0.85;
    if (searchMode === "wide") {
      threshold = 0.7;
    }

    const bestMatch = matchedStores.length > 0 ? matchedStores[0] : null;
    const similarityScore = bestMatch?.score || 0;

    if (matchedStores.length > 0 && similarityScore >= threshold) {
      responseData = {
        success: true,
        message: "가맹점을 찾았습니다.",
        isAffiliated: true,
        matchType: matchedStores.length === 1 ? "definitive" : "ambiguous",
        stores: matchedStores.map((store) => ({
          // stores 배열로 통일
          name: store.name,
          category: store.category,
          address: store.address,
          similarityScore: parseFloat(store.score.toFixed(2)),
        })),
        score: similarityScore,
      };
    } else {
      responseData = {
        success: true,
        isAffiliated: false,
        matchType: "none",
        message: "성남시 아동수당 가맹점을 찾을 수 없습니다.",
        stores: [], // stores 빈 배열로 통일
        score: null,
      };
    }

    const useTextUI = responseType === "text";

    if (useTextUI) {
      const textResponse = createTextUIResponse(responseData);
      return new NextResponse(textResponse, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    } else {
      return NextResponse.json(responseData); // JSON 응답 반환 (타입 명시 불필요)
    }
  } catch (error) {
    console.error("API 오류:", error);
    return NextResponse.json(
      { success: false, message: "API 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
