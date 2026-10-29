import type { Metadata } from "next";
import { ProfilePage } from "@/components/account/profile-page";
import { requirePageUser } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Mi negocio" };

export default async function CommerceProfile() {
  const user = await requirePageUser(["COMERCIO"], "/comercio/perfil");
  return <ProfilePage user={user} />;
}
