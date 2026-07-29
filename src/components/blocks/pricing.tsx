"use client";

import { Check, Loader } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PricingItem, Pricing as PricingType } from "@/types/blocks/pricing";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Icon from "@/components/icon";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useLocale } from "next-intl";
import { createCheckout } from "@/api/checkout";
import { AUTH_ROUTES, withLocale } from "@/config/auth";
import { isClientApiError, resolveErrorMessage } from "@/lib/errors/client";

const GROUP_GRID_CLASSES: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

const PLAN_GRID_CLASSES: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-2 xl:grid-cols-4",
};

function gridClassForCount(
  count: number,
  classes: Record<number, string>,
  fallback: string,
): string {
  if (count <= 1) return classes[1];
  return classes[count] ?? fallback;
}

export default function Pricing({ pricing }: { pricing: PricingType }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [group, setGroup] = useState(() => {
    // First look for a group with is_featured set to true
    const featuredGroup = pricing.groups?.find((g) => g.is_featured);
    // If no featured group exists, fall back to the first group
    return featuredGroup?.name || pricing.groups?.[0]?.name;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [productId, setProductId] = useState<string | null>(null);
  const visibleItems =
    pricing.items?.filter((item) => !item.group || item.group === group) ?? [];
  const checkoutAttemptRef = useRef<{
    fingerprint: string;
    intentId: string;
    inFlight: boolean;
  } | null>(null);

  const handleCheckout = async (item: PricingItem, cn_pay: boolean = false) => {
    const currency = cn_pay ? "cny" : item.currency;
    const fingerprint = `${item.product_id}:${currency}`;
    const currentAttempt = checkoutAttemptRef.current;

    // React state updates on the next render. This ref changes synchronously,
    // closing the small window where two click events can both observe
    // `isLoading === false` and send two requests.
    if (currentAttempt?.inFlight) return;

    const intentId =
      currentAttempt?.fingerprint === fingerprint
        ? currentAttempt.intentId
        : globalThis.crypto.randomUUID();
    checkoutAttemptRef.current = {
      fingerprint,
      intentId,
      inFlight: true,
    };

    try {
      const params = {
        product_id: item.product_id,
        currency,
        locale: locale || "en",
      };

      setIsLoading(true);
      setProductId(item.product_id);

      const data = await createCheckout(params, intentId);

      if (!data?.checkout_url) throw new Error("PAYMENT_SESSION_FAILED");

      // Keep the synchronous lock set after success. Navigation happens only
      // after the network response, and releasing here would reopen a second
      // click window while the browser is leaving this page.
      window.location.href = data.checkout_url;
    } catch (error) {
      const needsNewIntent =
        isClientApiError(error) &&
        (error.code === "CHECKOUT_INTENT_CONFLICT" ||
          error.code === "PAYMENT_SESSION_EXPIRED");

      checkoutAttemptRef.current = needsNewIntent
        ? null
        : { fingerprint, intentId, inFlight: false };
      setIsLoading(false);
      setProductId(null);

      // Preserve the page they were trying to buy from. AuthScreen validates
      // this same-origin relative callback before using it, so the query
      // parameter cannot become an open redirect.
      if (isClientApiError(error) && error.code === "AUTH_REQUIRED") {
        const query = searchParams.toString();
        const callbackPath = query ? `${pathname}?${query}` : pathname;
        router.push(
          `${withLocale(locale, AUTH_ROUTES.login)}?callbackUrl=${encodeURIComponent(
            callbackPath,
          )}`,
        );
        return;
      }

      console.error("checkout failed: ", error);
      toast.error(resolveErrorMessage(error, locale, "PAYMENT_SESSION_FAILED"));
    }
  };

  useEffect(() => {
    if (pricing.items) {
      const featuredItem = pricing.items.find((i) => i.is_featured);
      setProductId(featuredItem?.product_id || pricing.items[0]?.product_id);
      setIsLoading(false);
    }
  }, [pricing.items]);

  if (pricing.disabled) {
    return null;
  }

  return (
    <section id={pricing.name} className="py-16">
      <div className="container">
        <div className="mx-auto mb-12 text-center">
          <h1 className="mb-4 text-4xl font-semibold lg:text-5xl">
            {pricing.title}
          </h1>
          <p className="text-muted-foreground lg:text-lg">
            {pricing.description}
          </p>
        </div>
        <div className="w-full flex flex-col items-center gap-1">
          {pricing.groups && pricing.groups.length > 0 && (
            <div className="flex h-12 mb-12 items-center rounded-md bg-muted p-1 text-lg">
              <RadioGroup
                value={group}
                className={`h-full ${gridClassForCount(
                  pricing.groups.length,
                  GROUP_GRID_CLASSES,
                  "grid-flow-col auto-cols-fr",
                )}`}
                onValueChange={(value: string) => {
                  setGroup(value);
                }}
              >
                {pricing.groups.map((item, i) => {
                  return (
                    <div
                      key={i}
                      className='h-full rounded-md transition-all has-[button[data-state="checked"]]:bg-white'
                    >
                      <RadioGroupItem
                        value={item.name || ""}
                        id={item.name}
                        className="peer sr-only"
                      />
                      <Label
                        htmlFor={item.name}
                        className="flex h-full cursor-pointer items-center justify-center px-4 font-semibold text-muted-foreground peer-data-[state=checked]:text-primary"
                      >
                        {item.title}
                        {item.label && (
                          <Badge
                            variant="outline"
                            className="border-primary bg-primary px-1.5 ml-1 text-primary-foreground"
                          >
                            {item.label}
                          </Badge>
                        )}
                      </Label>
                    </div>
                  );
                })}
              </RadioGroup>
            </div>
          )}
          <div
            data-plan-grid
            className={`mt-0 grid w-full gap-6 ${gridClassForCount(
              visibleItems.length,
              PLAN_GRID_CLASSES,
              "md:grid-cols-2 xl:grid-cols-3",
            )}`}
          >
            {pricing.items?.map((item) => {
              if (item.group && item.group !== group) {
                return null;
              }

              return (
                <div
                  key={`${item.group ?? "all"}:${item.product_id}`}
                  className={`rounded-lg p-6 ${
                    item.is_featured
                      ? "border-primary border-2 bg-card text-card-foreground"
                      : "border-muted border"
                  }`}
                >
                  <div className="flex h-full flex-col justify-between gap-5">
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        {item.title && (
                          <h3 className="text-xl font-semibold">
                            {item.title}
                          </h3>
                        )}
                        <div className="flex-1"></div>
                        {item.label && (
                          <Badge
                            variant="outline"
                            className="border-primary bg-primary px-1.5 text-primary-foreground"
                          >
                            {item.label}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-end gap-2 mb-4">
                        {item.original_price && (
                          <span className="text-xl text-muted-foreground font-semibold line-through">
                            {item.original_price}
                          </span>
                        )}
                        {item.price && (
                          <span className="text-5xl font-semibold">
                            {item.price}
                          </span>
                        )}
                        {item.unit && (
                          <span className="block font-semibold">
                            {item.unit}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                      {item.features_title && (
                        <p className="mb-3 mt-6 font-semibold">
                          {item.features_title}
                        </p>
                      )}
                      {item.features && (
                        <ul className="flex flex-col gap-3">
                          {item.features.map((feature, fi) => {
                            return (
                              <li className="flex gap-2" key={`feature-${fi}`}>
                                <Check
                                  aria-hidden
                                  className="mt-1 size-4 shrink-0"
                                />
                                {feature}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      {item.cn_amount && item.cn_amount > 0 ? (
                        <div className="flex items-center gap-x-2 mt-2">
                          <span className="text-sm">人民币支付 👉</span>
                          <button
                            type="button"
                            aria-label={`Pay for ${
                              item.title ?? item.product_name
                            } in CNY`}
                            disabled={isLoading}
                            className="inline-block rounded-md p-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => {
                              if (isLoading) {
                                return;
                              }
                              handleCheckout(item, true);
                            }}
                          >
                            <img
                              src="/imgs/cnpay.png"
                              alt=""
                              aria-hidden
                              className="w-20 h-10 rounded-lg"
                            />
                          </button>
                        </div>
                      ) : null}
                      {item.button && (
                        <Button
                          className="w-full flex items-center justify-center gap-2 font-semibold"
                          disabled={isLoading}
                          aria-busy={isLoading && productId === item.product_id}
                          onClick={() => {
                            if (isLoading) {
                              return;
                            }
                            handleCheckout(item);
                          }}
                        >
                          <span>{item.button.title}</span>
                          {isLoading && productId === item.product_id && (
                            <Loader
                              aria-hidden
                              className="mr-2 h-4 w-4 animate-spin"
                            />
                          )}
                          {item.button.icon && (
                            <Icon
                              name={item.button.icon as any}
                              className="size-4"
                            />
                          )}
                        </Button>
                      )}
                      {item.tip && (
                        <p className="text-muted-foreground text-sm mt-2">
                          {item.tip}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
