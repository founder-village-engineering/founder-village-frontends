import { useCallback, useEffect, useRef, useState } from "react";
import { actionError, type MemberApi } from "./api";
import type { Membership, Offer } from "./generated/contracts/members";

export type BillingProps = {
  api: MemberApi;
  compact: boolean;
  returning: boolean;
};

export const methodNames = {
  card: "Credit card or Apple Pay",
  sol: "Solana (SOL)",
  usdc: "USDC on Solana",
};

export function formatAmount(offer: Offer) {
  return offer.currency === "USD"
    ? `$${offer.amount} USD`
    : `${offer.amount} ${offer.currency}`;
}

export function useMembership(api: MemberApi) {
  const [membership, setMembership] = useState<Membership>();
  const [error, setError] = useState("");
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setError("");
    try {
      const result = await api.membership();
      if (generation.current === current) setMembership(result);
    } catch (error) {
      if (generation.current === current)
        setError(
          actionError(error, "Could not load your membership. Try again."),
        );
    }
  }, [api]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { membership, error, reload };
}
