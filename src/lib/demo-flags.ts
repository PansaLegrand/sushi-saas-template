import { getAppEnv, isProductionRuntime } from "@/lib/env";

export { isProductionRuntime };

export function areDemoFeaturesEnabled(): boolean {
  return !isProductionRuntime() && getAppEnv().ENABLE_DEMO_FEATURES;
}

export function isAccountCreditGrantEnabled(): boolean {
  return areDemoFeaturesEnabled() && getAppEnv().ENABLE_ACCOUNT_CREDIT_GRANT;
}

export function isCreditsPlaygroundEnabled(): boolean {
  return areDemoFeaturesEnabled() && getAppEnv().ENABLE_CREDITS_PLAYGROUND;
}

export function isTextToVideoMockEnabled(): boolean {
  return areDemoFeaturesEnabled() && getAppEnv().ENABLE_TEXT2VIDEO_MOCK;
}

export function isReservationDemoAutoSeedEnabled(): boolean {
  return (
    areDemoFeaturesEnabled() &&
    (getAppEnv().RESERVATIONS_AUTO_SEED_DEMO ||
      getAppEnv().NEXT_PUBLIC_RESERVATIONS_AUTO_SEED_DEMO)
  );
}
