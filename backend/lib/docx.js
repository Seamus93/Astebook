import mammoth from "mammoth";

export async function parseDocxBuffer(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result.value || "",
    messages: result.messages || [],
  };
}
