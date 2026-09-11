import Workspace from './workspace';
import { getUser } from './auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await getUser();
  return <Workspace signedIn={!!user} />;
}
