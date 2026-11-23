import {
  hasOidc,
  parseRuntimeConfig,
  type BrowserSession,
  type RuntimeConfig,
} from "@founder-village/frontend-platform";
import {
  AuthRequest,
  CodeChallengeMethod,
  exchangeCodeAsync,
  ResponseType,
} from "expo-auth-session";
import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Linking } from "react-native";

const key = "founder-village-members.session.v1";
const redirectUri = "com.foundervillage.members://auth/callback";
const persistence = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const initialScreen = () => "directory" as const;
export const checkoutReturned = () => false;
export const showDeletion = () => false;
export const canSignIn = hasOidc;
export const newRequestKey = randomUUID;

export function getConfig() {
  return parseRuntimeConfig({
    apiOrigin: process.env.EXPO_PUBLIC_FV_API_ORIGIN,
    authorizationEndpoint:
      process.env.EXPO_PUBLIC_FV_OIDC_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: process.env.EXPO_PUBLIC_FV_OIDC_TOKEN_ENDPOINT,
    clientId: process.env.EXPO_PUBLIC_FV_OIDC_CLIENT_ID,
    audience: process.env.EXPO_PUBLIC_FV_OIDC_AUDIENCE,
  });
}

export async function restoreSession(
  _config: RuntimeConfig,
): Promise<BrowserSession | undefined> {
  const raw = await SecureStore.getItemAsync(key, persistence);
  if (raw) {
    try {
      const session = JSON.parse(raw) as Partial<BrowserSession>;
      if (
        typeof session.accessToken === "string" &&
        session.accessToken.length > 0 &&
        session.accessToken.length <= 12000 &&
        typeof session.expiresAt === "number" &&
        session.expiresAt > Date.now() + 5000
      )
        return {
          accessToken: session.accessToken,
          expiresAt: session.expiresAt,
        };
    } catch {
      // A corrupt local session can be replaced by a fresh sign-in.
    }
    await signOut();
  }
}

export async function signIn(
  config: RuntimeConfig,
): Promise<BrowserSession | undefined> {
  if (!hasOidc(config)) throw new Error("Sign-in is not configured.");
  const discovery = {
    authorizationEndpoint: config.authorizationEndpoint,
    tokenEndpoint: config.tokenEndpoint,
  };
  const request = new AuthRequest({
    clientId: config.clientId,
    redirectUri,
    responseType: ResponseType.Code,
    scopes: ["openid", "profile", "email"],
    usePKCE: true,
    codeChallengeMethod: CodeChallengeMethod.S256,
    extraParams: config.audience ? { audience: config.audience } : {},
  });
  const response = await request.promptAsync(discovery);
  if (response.type === "cancel" || response.type === "dismiss")
    return undefined;
  if (
    response.type !== "success" ||
    response.params.state !== request.state ||
    !response.params.code ||
    !request.codeVerifier
  ) {
    throw new Error("Sign-in could not be completed.");
  }
  const token = await exchangeCodeAsync(
    {
      clientId: config.clientId,
      redirectUri,
      code: response.params.code,
      extraParams: { code_verifier: request.codeVerifier },
    },
    discovery,
  );
  if (
    !token.accessToken ||
    token.accessToken.length > 12000 ||
    !token.expiresIn ||
    !Number.isFinite(token.expiresIn) ||
    token.expiresIn < 60 ||
    token.expiresIn > 7200
  ) {
    throw new Error("Sign-in returned an invalid session.");
  }
  const session = {
    accessToken: token.accessToken,
    expiresAt: Date.now() + token.expiresIn * 1000,
  };
  await SecureStore.setItemAsync(key, JSON.stringify(session), persistence);
  return session;
}

export function signOut() {
  return SecureStore.deleteItemAsync(key, persistence);
}

export async function openExternal(url: string) {
  await Linking.openURL(url);
}
