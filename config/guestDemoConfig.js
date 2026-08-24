// Single source of truth for the guest demo system's tunables.
// Both the signup auto-credit (guestLogin.js) and the manual top-up
// (guestDummyWalletCredit.js) read the amount from here, so they can never drift.

// Fake wallet money handed to a guest so the whole portal can be explored
// (create a project, buy a service plan, pay an invoice) without any real
// money and without any admin approval — a wallet-covered purchase is
// approved instantly by the existing payment engine.
const GUEST_DEMO_CREDIT_AMOUNT = 50000;

// A guest is deleted after this much inactivity (see purgeExpiredGuests.js).
const GUEST_INACTIVITY_MS = 24 * 60 * 60 * 1000;

module.exports = {
  GUEST_DEMO_CREDIT_AMOUNT,
  GUEST_INACTIVITY_MS,
};
