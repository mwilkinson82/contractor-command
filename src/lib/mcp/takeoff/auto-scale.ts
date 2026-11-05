import type { Sb } from "../guard";
import { audit, type Job } from "../jobs";
import { plainCalibration } from "./calibration";
import { saveCalibration, type StoredPage } from "./service";

/** Opening a sheet with no scale yet applies the one it plainly states: two dimension
 *  strings that agree with the title block, or the title block's single printed scale on
 *  a standard full-size sheet. Nobody has to set it. Returns true when a scale was saved.
 *  Never throws, so the sheet still opens when its scale can't be read or another open
 *  saved one first. */
export async function applyPlainScale(
  sb: Sb,
  job: Job,
  state: { calibrations?: { source_id: string; page: number }[] },
  page: StoredPage | undefined,
): Promise<boolean> {
  if (
    !page?.inspection ||
    (state.calibrations ?? []).some((c) => c.source_id === page.source.id && c.page === page.page)
  )
    return false;
  const plain = plainCalibration(page.space, page.inspection);
  if (!plain) return false;
  try {
    await saveCalibration(sb, job, page, plain, 0);
  } catch {
    return false;
  }
  try {
    await audit(sb, job, "takeoff_geometry", "auto_sheet_calibration", plain.region);
  } catch {
    // The scale is saved; a missed audit row never blocks opening the sheet.
  }
  return true;
}
