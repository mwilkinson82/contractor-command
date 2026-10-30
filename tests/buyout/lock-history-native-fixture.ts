import { makeBuyoutDb, ids } from "./fixture";
import { schedulingBuyoutDb } from "../scheduling-buyout-db";
export { ids };
export async function install() {
  const db = await makeBuyoutDb(schedulingBuyoutDb);
  await db.close();
}
export { buyoutProjection } from "../../src/lib/mcp/buyout";
export { orderVersions, orderTotal } from "../../src/lib/purchase-order-workspace";
