import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

/** Shape accepted by `admin.credential.cert()`. */
export type FirebaseServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function fromLegacyJson(raw: {
  project_id?: string;
  client_email?: string;
  private_key?: string;
}): FirebaseServiceAccount | null {
  if (!raw.project_id || !raw.client_email || !raw.private_key) {
    return null;
  }
  return {
    projectId: raw.project_id,
    clientEmail: raw.client_email,
    privateKey: raw.private_key,
  };
}

export type FirebaseCredentialSource = 'env' | 'legacy-file' | null;

/** Build Firebase service account from env vars or legacy `serviceAccount.json`. */
export function resolveFirebaseCredential(
  configService: ConfigService,
): { credential: FirebaseServiceAccount; source: FirebaseCredentialSource } | null {
  const projectId = configService.get<string>('FIREBASE_PROJECT_ID')?.trim();
  const clientEmail = configService
    .get<string>('FIREBASE_CLIENT_EMAIL')
    ?.trim();
  const privateKey = configService
    .get<string>('FIREBASE_PRIVATE_KEY')
    ?.replace(/\\n/g, '\n')
    .trim();

  if (projectId && clientEmail && privateKey) {
    return {
      credential: {
        projectId,
        clientEmail,
        privateKey,
      },
      source: 'env',
    };
  }

  const legacyPath = path.join(process.cwd(), 'serviceAccount.json');
  if (fs.existsSync(legacyPath)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const legacy = fromLegacyJson(require(legacyPath));
    if (legacy) {
      return { credential: legacy, source: 'legacy-file' };
    }
  }

  return null;
}
