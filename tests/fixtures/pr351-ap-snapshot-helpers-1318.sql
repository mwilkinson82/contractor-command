-- Test-only helper definitions from PR351 commit 1318fa2.

CREATE FUNCTION public.mcp_cost_currency_supported(_code text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public AS $$ SELECT coalesce(_code=ANY(ARRAY['AED','AMD','ANG','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BGN','BMD','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF','CNY','COP','CRC','CUC','CUP','CVE','CZK','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GTQ','GYD','HKD','HNL','HRK','HTG','HUF','IDR','ILS','INR','JMD','KES','KGS','KHR','KYD','KZT','LKR','LRD','LSL','MAD','MDL','MKD','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','PAB','PEN','PGK','PHP','PKR','PLN','QAR','RON','RUB','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SRD','SSP','STN','SVC','SZL','THB','TJS','TMT','TOP','TRY','TTD','TWD','TZS','UAH','USD','UYU','UZS','VES','WST','XCD','XCG','XDR','XSU','ZAR','ZMW','ZWG','ZWL']::text[]),false) $$;

CREATE FUNCTION public.mcp_cost_valid_date(_date text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
BEGIN
 IF coalesce(_date,'') !~ '^\d{4}-\d{2}-\d{2}$' OR left(_date,4)='0000' THEN RETURN false; END IF;
 RETURN to_char(_date::date,'YYYY-MM-DD')=_date;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;
