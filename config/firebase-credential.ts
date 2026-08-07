import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_KEYS } from '../src/common/constants/config.constants';

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
  // 1. Check from a single JSON string (FIREBASE_CREDENTIALS)
  const firebaseCredentialsJson = process.env.FIREBASE_CREDENTIALS;
  if (firebaseCredentialsJson) {
    try {
      const parsed = JSON.parse(firebaseCredentialsJson);
      const legacy = fromLegacyJson(parsed);
      if (legacy) {
        return { credential: legacy, source: 'env' };
      }
    } catch (e) {
      console.error('Failed to parse FIREBASE_CREDENTIALS env var', e);
    }
  }

  // 2. Check from individual environment variables
  const projectId = configService.get<string>(CONFIG_KEYS.FIREBASE_PROJECT_ID)?.trim();
  const clientEmail = configService
    .get<string>(CONFIG_KEYS.FIREBASE_CLIENT_EMAIL)
    ?.trim();
  const privateKey = configService
    .get<string>(CONFIG_KEYS.FIREBASE_PRIVATE_KEY)
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

  // 3. Check from local files (legacy)
  const legacyPaths = [
    path.join(process.cwd(), 'serviceAccount.json'),
    path.join(process.cwd(), '..', 'swift-chat-backend-firebase-adminsdk-fbsvc-eda6195765.json')
  ];

  for (const legacyPath of legacyPaths) {
    if (fs.existsSync(legacyPath)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const legacy = fromLegacyJson(require(legacyPath));
      if (legacy) {
        return { credential: legacy, source: 'legacy-file' };
      }
    }
  }

  return null;
}
