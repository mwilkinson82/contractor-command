import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";
const owner="00000000-0000-4000-8000-000000000011", member="00000000-0000-4000-8000-000000000012", other="00000000-0000-4000-8000-000000000013";
const a="00000000-0000-4000-8000-000000000021", b="00000000-0000-4000-8000-000000000022";
let db:PGlite;
const call=(user:string, company:string, fn:"mcp_company_brand_save"|"mcp_company_save", payload:object)=>asUser(db,{sub:user,role:"authenticated",email:"fixture@example.test"},tx=>tx.query(`SELECT ${fn}($1,$2::jsonb)`,[company,JSON.stringify(payload)]));
beforeAll(async()=>{
  db=await makeDb();
  for(const id of [owner,member,other]) { await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[id,`${id}@example.test`]); await db.query("INSERT INTO test_active_members VALUES($1)",[id]); }
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Company A',$2),($3,'Company B',$4)",[a,owner,b,other]);
  await db.query("INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Owner'),($1,$3,'pm','Member'),($4,$5,'owner','Other')",[a,owner,member,b,other]);
});
afterAll(async()=>{await db?.close();});
describe("existing company branding authorization",()=>{
  it("permits the selected company owner and rejects members and other companies",async()=>{
    const logo="https://backend.example/storage/v1/object/public/company-logos/owner/logo.png";
    await call(owner,a,"mcp_company_brand_save",{logo_url:logo});
    await call(owner,a,"mcp_company_save",{name:"Renamed A"});
    await expect(call(member,a,"mcp_company_brand_save",{logo_url:"https://example.test/no.png"})).rejects.toThrow(/Only a company Owner/);
    await expect(call(owner,b,"mcp_company_brand_save",{logo_url:logo})).rejects.toThrow(/Only a company Owner/);
    await expect(call(owner,b,"mcp_company_save",{name:"Wrong company"})).rejects.toThrow(/Only a company Owner/);
    const rows=await db.query<{name:string;logo_url:string|null}>("SELECT name,logo_url FROM mcp_companies ORDER BY id");
    expect(rows.rows).toEqual([{name:"Renamed A",logo_url:logo},{name:"Company B",logo_url:null}]);
  });
});
