import { getCurrentUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { noStore } from "@/server/http";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return noStore({ count: 0 });
  const count = await db.notification.count({ where: { userId: user.id, readAt: null } });
  return noStore({ count });
}
