import axios, { AxiosInstance } from 'axios';
import http from 'node:http';
import https from 'node:https';
import { ssrfSafeLookup } from '@gitroom/helpers/utils/ssrf.safe.fetch';

export {
  getSsrfSafeDispatcher,
  ssrfSafeDispatcher,
} from '@gitroom/helpers/utils/ssrf.safe.fetch';

// axios can't use an undici dispatcher, but Node's http(s) agents accept the
// same `lookup` hook, so axios requests (providers that need form-data /
// stream uploads) get the identical pinned-DNS guard as `this.fetch`.
const ssrfSafeAxios = axios.create({
  httpAgent: new http.Agent({ lookup: ssrfSafeLookup } as http.AgentOptions),
  httpsAgent: new https.Agent({
    lookup: ssrfSafeLookup,
  } as https.AgentOptions),
});

// DISABLE_SSRF_PROTECTION=true opts self-hosted deployments with private
// network integrations out of the IP guard, same as getSsrfSafeDispatcher.
export function getSsrfSafeAxios(): AxiosInstance {
  return process.env.DISABLE_SSRF_PROTECTION === 'true' ? axios : ssrfSafeAxios;
}
