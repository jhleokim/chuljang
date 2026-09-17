import Workspace from './workspace';
import { getChatGPTUser } from './chatgpt-auth';
import {env} from 'cloudflare:workers';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await getChatGPTUser();
  return <Workspace signedIn={!!user} testMode={Reflect.get(env,'TEST_MODE')==='1'} homeMode={!!Reflect.get(env,'HOME_ORIGIN')} accountName={user?.displayName||''} accountId={user?.userId||''} />;
}
