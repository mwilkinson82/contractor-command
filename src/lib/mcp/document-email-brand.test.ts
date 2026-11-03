import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { documentEmailBrand } from './document-email-brand';
import { paymentApplicationArtifact } from './document-email-artifact';
import { applicationFixture } from '../payment-applications/fixtures';
import { calculateApplication } from '../payment-applications/model';
import { applicationPdf } from '../payment-applications/pdf';

const logo=new Uint8Array(readFileSync('tests/fixtures/payment-brand/logo.jpg'));
const sb=(id:string,name='Project Company',logo_url='https://backend.example/storage/v1/object/public/company-logos/owner/logo.jpg')=>({from:()=>({select:()=>({eq:()=>({single:async()=>({data:{id,name,logo_url},error:null})})})})}) as never;
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs()});
describe('job company document branding',()=>{
 it('uses the same real branded PDF bytes and changes the reviewed hash when branding changes',async()=>{
  vi.stubEnv('VITE_SUPABASE_URL','https://backend.example');
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(logo,{headers:{'content-length':String(logo.length)}}));
  const brand=await documentEmailBrand(sb('company-a'),'company-a');expect(brand.companyName).toBe('Project Company');expect(brand.logo).toEqual(logo);
  const body=applicationFixture(),id='00000000-0000-4000-8000-000000000002';
  const selected={application_id:id,version:1,latest_version:1,body,calculation:calculateApplication(body),billing_version:null,recorded_at:'2026-02-01T12:00:00Z',history:[]};
  const context={job:{number:'1',name:'Fixture'},currency:'USD' as const,snapshot:body.snapshot,evidence:[],applications:[],selected};
  const args={companyId:'company-a',jobId:'job-a',applicationId:id,version:1,allowHistorical:false,context};
  const branded=await paymentApplicationArtifact({...args,brand}),plain=await paymentApplicationArtifact(args);
  expect(Buffer.from(branded.content_base64,'base64')).toEqual(Buffer.from(applicationPdf(context.job,selected,brand)));
  expect(branded.sha256).not.toBe(plain.sha256);
 });
 it('refuses an unverified or mismatched company rather than using the account profile',async()=>{
  await expect(documentEmailBrand(sb('company-b'),'company-a')).rejects.toThrow(/could not be verified/);
 });
});
