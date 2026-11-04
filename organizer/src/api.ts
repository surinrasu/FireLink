import type { UploadedMedia } from "../../shared/media";
let organizationId = "";
export const setOrganization = (id: string) => {
  organizationId = id;
};
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function uploadMedia(
  file: File,
  signal: AbortSignal,
  progress: (percent: number) => void,
): Promise<UploadedMedia> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/organizer/media");
    request.timeout = 5 * 60 * 1000;
    request.setRequestHeader("X-FireLink-Request", "organizer");
    request.setRequestHeader("X-Organization-Id", organizationId);
    request.setRequestHeader("Content-Type", file.type);
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.setRequestHeader("X-File-Size", String(file.size));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.round((event.loaded / event.total) * 100));
    };
    const abort = () => request.abort();
    signal.addEventListener("abort", abort, { once: true });
    request.onloadend = () => signal.removeEventListener("abort", abort);
    request.onabort = () => reject(new APIError("上传已取消。", 0));
    request.onerror = request.ontimeout = () =>
      reject(new APIError("上传中断，请检查网络后重试。", 0));
    request.onload = () => {
      let result;
      try {
        result = JSON.parse(request.responseText);
      } catch {
        return reject(new APIError("上传未完成，请重试。", request.status));
      }
      if (request.status >= 200 && request.status < 300) resolve(result);
      else
        reject(
          new APIError(result.error || "上传未完成，请重试。", request.status),
        );
    };
    if (signal.aborted) return reject(new APIError("上传已取消。", 0));
    request.send(file);
  });
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/organizer${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        "X-FireLink-Request": "organizer",
        ...(organizationId ? { "X-Organization-Id": organizationId } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
        : AbortSignal.timeout(25000),
    });
  } catch {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    throw new APIError(
      navigator.onLine
        ? "连接超时。若刚才提交了操作，请先刷新确认结果，再重试。"
        : "网络已断开，请恢复连接后重试。",
      0,
    );
  }
  const result = await response
    .json()
    .catch(() => ({ error: "服务暂时不可用，请稍后重试。" }));
  if (!response.ok)
    throw new APIError(result.error ?? "操作未完成，请重试。", response.status);
  return result as T;
}
