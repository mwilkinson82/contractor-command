export const FILE_UPLOAD_ORIGIN = "https://app.meetathena.io";
export const FILE_UPLOAD_LINK_BASE = `${FILE_UPLOAD_ORIGIN}/r/file-upload/`;

/** Cookie-free upload capability only; completion still requires the authenticated MCP tool. */
export const isFileUploadPut = (method: string, pathname: string) =>
  method === "PUT" && /^\/r\/file-upload\/[A-Za-z0-9_-]{43}$/.test(pathname);
