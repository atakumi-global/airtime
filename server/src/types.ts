export const ROLES = ['administrator', 'manager', 'member'] as const;
export type Role = (typeof ROLES)[number];

export type MemberRow = {
  id: string;
  organisation_id: string;
  email: string;
  display_name: string;
  role: Role;
  status: 'active' | 'removed';
  password_hash: string | null;
  oidc_subject: string | null;
  created_at: Date;
  updated_at: Date;
};

export type PublicMember = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: 'active' | 'removed';
};

export function toPublicMember(member: MemberRow): PublicMember {
  return {
    id: member.id,
    email: member.email,
    displayName: member.display_name,
    role: member.role,
    status: member.status,
  };
}
