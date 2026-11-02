import { describe, expect, it } from 'vitest';
import { finalizeVisible } from './visible';
import { displayFactsResult } from './cards/display-result';
describe('document email visible result',()=>{
 it('preserves reported provenance and does not claim recipient delivery',()=>{
  const r=displayFactsResult(finalizeVisible({content:[{type:'text' as const,text:'Provider acceptance was reported by the assistant. Recipient delivery is not verified.'}],structuredContent:{state:'host_reported_provider_acceptance'}}));
  expect(r.content[0].text).toContain('reported by the assistant');expect(r.content[0].text).toContain('delivery is not verified');
 });
});
