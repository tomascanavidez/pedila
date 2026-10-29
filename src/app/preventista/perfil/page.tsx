import type { Metadata } from "next";
import { ProfilePage } from "@/components/account/profile-page";
import { requirePageUser } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Mi negocio" };

export default async function DistributorProfile() {
  const user = await requirePageUser(["PREVENTISTA"], "/preventista/perfil");
  return <ProfilePage user={user} />;
}
