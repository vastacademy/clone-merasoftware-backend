// Shared rules for reading the feature_upgrades catalogue, so every order-creation
// path resolves the same features for the same project category.
//
// A feature's compatibleWith[] carries which project categories it is offered for,
// where an EMPTY array means "all categories". That convention is set in the admin
// Features form (AdminFeatureProductsPage.js) and mirrored client-side by
// helpers/projectCategoryOptions.js's isFeatureForCategory() — this module is the
// server half, so the query and the UI filter cannot drift apart.

const FEATURE_UPGRADE_CATEGORY = "feature_upgrades";

// Mongo condition selecting the features offered for `category`: either explicitly
// tagged with it, or tagged with nothing at all (= all categories).
//
// $size: 0 matches only a present-but-empty array, so the "no categories set" arms
// also cover a record whose compatibleWith was never written (missing) or was stored
// as null. Kept in step with isFeatureForCategory() on the client, which treats every
// non-array or empty value as "all categories" — a shape allowed by one side and
// rejected by the other would show a feature the order then silently drops.
const featureCategoryCondition = (category) => ({
  $or: [
    { compatibleWith: category },
    { compatibleWith: { $size: 0 } },
    { compatibleWith: { $exists: false } },
    { compatibleWith: null },
  ],
});

// Full filter for the features a project order may include. Callers add their own
// _id / isHidden constraints on top.
const featureCatalogueFilter = (category) => ({
  category: FEATURE_UPGRADE_CATEGORY,
  ...featureCategoryCondition(category),
});

module.exports = {
  FEATURE_UPGRADE_CATEGORY,
  featureCategoryCondition,
  featureCatalogueFilter,
};
