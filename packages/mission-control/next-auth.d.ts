import type { DefaultSession, DefaultUser } from 'next-auth';
import type { DefaultJWT } from 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      operatorId: string;
      displayName: string;
      tier: 'root' | 'department_head' | 'contributor' | 'observer';
      departments: string[];
      roleIds: string[];
    } & DefaultSession['user'];
  }

  interface User extends DefaultUser {
    operatorId: string;
    displayName: string;
    tier: 'root' | 'department_head' | 'contributor' | 'observer';
    departments: string[];
    roleIds: string[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    operatorId: string;
    displayName: string;
    tier: 'root' | 'department_head' | 'contributor' | 'observer';
    departments: string[];
    roleIds: string[];
  }
}
