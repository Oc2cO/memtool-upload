import { documentDirectory, writeAsStringAsync, EncodingType } from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

/**
 * Write `content` to a file in the app's document directory and open
 * the iOS share sheet so the user can save it to Files, send via Mail,
 * AirDrop, etc.
 *
 * This is the only place in the codebase that touches expo-file-system
 * and expo-sharing so callers stay readable and the platform-specific
 * bits are isolated here.
 */
export async function writeAndShare(
  filename: string,
  content: string,
  mimeType: string,
  dialogTitle = "Save your memories",
): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error("Sharing is not available on this device.");
  }

  const uri = (documentDirectory ?? "") + filename;
  await writeAsStringAsync(uri, content, { encoding: EncodingType.UTF8 });

  await Sharing.shareAsync(uri, {
    mimeType,
    UTI: mimeType === "application/json" ? "public.json" : "public.comma-separated-values-text",
    dialogTitle,
  });
}
