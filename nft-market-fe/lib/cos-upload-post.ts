import axios from "axios";

// 服务端代理上传：文件 POST 到后端 /api/v1/upload/file，后端用主密钥上传到 COS 并返回公开 URL。

/**
 * 上传任意文件到 COS（服务端代理模式）。
 * @param file      要上传的文件
 * @param fileType  文件类型：image | video | audio | document
 * @returns 公开访问 URL
 */
async function uploadFile(file: File, fileType: string): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("file_type", fileType);

  console.log("[upload] 服务端代理上传:", file.name, fileType, file.size);
  const resp = await axios.post("/api/v1/upload/file", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e) => {
      if (e.total) {
        const pct = Math.round((e.loaded * 100) / e.total);
        console.log(`[upload] 进度: ${pct}%`);
      }
    },
  });

  // 后端返回格式: { code: 200, data: { result: "https://..." } }
  const url = resp.data?.data?.result || resp.data?.result;
  if (!url) throw new Error("未获取到上传文件 URL");
  console.log("[upload] 成功:", url);
  return url;
}

// ── 图片上传 ──────────────────────────────────────────────

export async function getCOSToken(
  _fileType: "image" | "video" | "audio" | "document",
  _fileName: string,
  _fileSize: number
): Promise<any> {
  // 服务端代理模式下不再需要独立获取凭证，保留接口兼容性，直接返回空 token。
  return { result: {} };
}

/** 上传图片到 COS（代理模式） */
export async function uploadFileToCOSPost(file: File): Promise<string> {
  return uploadFile(file, "image");
}

// ── Metadata JSON 上传 ───────────────────────────────────

export interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  attributes?: Array<{ trait_type: string; value: string | number }>;
}

/** 将 metadata 对象序列化为 JSON 文件并上传到 COS（代理模式） */
export async function uploadMetadataToCOSPost(metadata: NFTMetadata): Promise<string> {
  const json = JSON.stringify(metadata, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const file = new File([blob], `metadata_${Date.now()}.json`, {
    type: "application/json",
  });
  return uploadFile(file, "document");
}