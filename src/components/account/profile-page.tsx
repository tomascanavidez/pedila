import { ProfileForm } from "@/components/forms/profile-form";
import { PageHeader } from "@/components/ui/display";
import { formatCuit } from "@/domain/cuit";
import type { CurrentUser } from "@/server/auth/guards";
import { db } from "@/server/db";
import { listGeo } from "@/server/queries/public";

/** Página "Mi negocio" compartida por comercios y preventistas. */
export async function ProfilePage({ user }: { user: CurrentUser }) {
  const [geo, u] = await Promise.all([
    listGeo(),
    db.user.findUniqueOrThrow({ where: { id: user.id }, include: { business: { include: { coverage: true } } } }),
  ]);
  const b = u.business!;
  return (
    <>
      <PageHeader title="Mi negocio" description={`CUIT ${formatCuit(b.cuit)}`} />
      <ProfileForm
        geo={geo}
        isDistributor={user.role === "PREVENTISTA"}
        hasPassword={Boolean(u.passwordHash)}
        user={{ name: u.name, email: u.email, phone: u.phone }}
        defaults={{
          legalName: b.legalName,
          tradeName: b.tradeName,
          cuit: formatCuit(b.cuit),
          ivaCondition: b.ivaCondition,
          street: b.street,
          streetNumber: b.streetNumber,
          floorApt: b.floorApt,
          postalCode: b.postalCode,
          provinceId: b.provinceId,
          localityId: b.localityId,
          description: b.description,
          coverage: b.coverage.map((c) => ({ provinceId: c.provinceId, localityId: c.localityId })),
        }}
      />
    </>
  );
}
