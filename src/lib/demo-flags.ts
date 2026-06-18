function readBooleanEnv(name: string, fallback = false): boolean {
  const value = process.env[name];

  if (value === undefined || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function areDemoFeaturesEnabled(): boolean {
  return !isProductionRuntime() && readBooleanEnv("ENABLE_DEMO_FEATURES");
}

export function isAccountCreditGrantEnabled(): boolean {
  return areDemoFeaturesEnabled() && readBooleanEnv("ENABLE_ACCOUNT_CREDIT_GRANT");
}

export function isCreditsPlaygroundEnabled(): boolean {
  return areDemoFeaturesEnabled() && readBooleanEnv("ENABLE_CREDITS_PLAYGROUND");
}

export function isTextToVideoMockEnabled(): boolean {
  return areDemoFeaturesEnabled() && readBooleanEnv("ENABLE_TEXT2VIDEO_MOCK");
}

export function isReservationDemoAutoSeedEnabled(): boolean {
  return (
    areDemoFeaturesEnabled() &&
    (readBooleanEnv("RESERVATIONS_AUTO_SEED_DEMO") ||
      readBooleanEnv("NEXT_PUBLIC_RESERVATIONS_AUTO_SEED_DEMO"))
  );
}
