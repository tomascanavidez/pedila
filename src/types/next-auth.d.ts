import type { DefaultSession } from "next-auth";
import type { DistributorStatus, Role } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      businessId: string | null;
      distributorStatus: DistributorStatus | null;
      profileComplete: boolean;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid: string;
    role: Role;
    bid?: string | null;
    dst?: DistributorStatus | null;
    pc?: boolean;
    refreshedAt?: number;
  }
}
