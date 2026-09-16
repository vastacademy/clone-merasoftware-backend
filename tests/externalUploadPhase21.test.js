const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const {
  createExternalUploadToken,
  digestExternalUploadToken,
  buildExternalUploadUrl,
} = require("../helpers/externalUploadToken");
const {
  issueExternalUploadSession,
  readExternalUploadSession,
  SESSION_STAGE,
  AUTH_MODE,
  COOKIE_NAME,
} = require("../helpers/externalUploadSession");
const {
  encodeExternalUploadHistoryCursor,
  decodeExternalUploadHistoryCursor,
  getExternalUploadHistoryLimit,
} = require("../helpers/externalUploadHistoryCursor");
const externalUploadLinkModel = require("../models/externalUploadLinkModel");
const userModel = require("../models/userModel");
const orderModel = require("../models/orderProductModel");
const { resolveExternalUploadAccess } = require("../helpers/externalUploadAccessPolicy");
const externalUploadLinkController = require("../controller/user/externalUploadLinkController");

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  FRONTEND_URL: process.env.FRONTEND_URL,
  EXTERNAL_UPLOAD_TOKEN_SECRET: process.env.EXTERNAL_UPLOAD_TOKEN_SECRET,
  TOKEN_SECRET_KEY: process.env.TOKEN_SECRET_KEY,
};

test.after(() => {
  Object.entries(ORIGINAL_ENV).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

test("token codec creates a high-entropy token and a canonical fragment URL", () => {
  process.env.NODE_ENV = "production";
  process.env.FRONTEND_URL = "https://portal.example.com/some-path";
  const token = createExternalUploadToken();
  const publicUrl = new URL(buildExternalUploadUrl(token));

  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(digestExternalUploadToken(token).length, 64);
  assert.equal(publicUrl.origin, "https://portal.example.com");
  assert.equal(publicUrl.pathname, "/external-upload");
  assert.equal(publicUrl.hash, `#token=${token}`);
  assert.equal(publicUrl.pathname.includes(token), false);
});

test("production public URL configuration fails closed", () => {
  process.env.NODE_ENV = "production";
  delete process.env.FRONTEND_URL;
  assert.throws(() => buildExternalUploadUrl(createExternalUploadToken()), /FRONTEND_URL/);
});

test("scoped session distinguishes challenge and both access modes", () => {
  process.env.NODE_ENV = "test";
  process.env.EXTERNAL_UPLOAD_TOKEN_SECRET = "phase-2.1-test-secret-with-more-than-32-characters";
  const ids = { linkId: "link-1", customerId: "customer-1", orderId: "order-1" };

  const roundTrip = (stage, authMode = null) => {
    let cookie;
    const res = { cookie: (name, value, options) => { cookie = { name, value, options }; } };
    issueExternalUploadSession({ res, ...ids, stage, authMode });
    const decoded = readExternalUploadSession({ cookies: { [cookie.name]: cookie.value } });
    assert.equal(cookie.name, COOKIE_NAME);
    assert.equal(cookie.options.path, "/api/external-upload");
    assert.equal(decoded.stage, stage);
    assert.equal(decoded.authMode, authMode);
  };

  roundTrip(SESSION_STAGE.CHALLENGE);
  roundTrip(SESSION_STAGE.ACCESS, AUTH_MODE.LINK);
  roundTrip(SESSION_STAGE.ACCESS, AUTH_MODE.CREDENTIALS);
});

test("normal portal JWT cannot be read as an external upload session", () => {
  process.env.EXTERNAL_UPLOAD_TOKEN_SECRET = "phase-2.1-test-secret-with-more-than-32-characters";
  const normalPortalToken = jwt.sign(
    { _id: "customer-1", role: "customer" },
    process.env.EXTERNAL_UPLOAD_TOKEN_SECRET,
  );
  assert.equal(readExternalUploadSession({ cookies: { [COOKIE_NAME]: normalPortalToken } }), null);
});

test("external session secret never falls back to the normal portal secret", () => {
  process.env.TOKEN_SECRET_KEY = "normal-portal-secret-with-more-than-32-characters";
  delete process.env.EXTERNAL_UPLOAD_TOKEN_SECRET;
  const res = { cookie: () => {} };
  assert.throws(() => issueExternalUploadSession({
    res,
    linkId: "link-1",
    customerId: "customer-1",
    orderId: "order-1",
    stage: SESSION_STAGE.CHALLENGE,
  }), /EXTERNAL_UPLOAD_TOKEN_SECRET/);
});

test("live access policy applies revoke and consent changes without trusting the cookie alone", async () => {
  const originalLinkFindOne = externalUploadLinkModel.findOne;
  const originalUserFindOne = userModel.findOne;
  const originalOrderFindOne = orderModel.findOne;
  let activeLink = { _id: "link-1", mode: "multiple", status: "active" };
  let allowLoginFreeUploadLinks = false;
  const queryFor = (value) => ({ select() { return this; }, lean: async () => value });

  externalUploadLinkModel.findOne = () => ({ lean: async () => activeLink });
  userModel.findOne = () => queryFor({
    _id: "customer-1",
    isActive: true,
    isGuest: false,
    deletedAt: null,
    allowLoginFreeUploadLinks,
  });
  orderModel.findOne = () => queryFor({
    _id: "order-1",
    userId: "customer-1",
    isWebsiteProject: true,
    isServicePlan: false,
  });

  const baseSession = {
    linkId: "link-1",
    customerId: "customer-1",
    orderId: "order-1",
    stage: SESSION_STAGE.ACCESS,
  };

  try {
    await assert.rejects(
      resolveExternalUploadAccess({ session: { ...baseSession, authMode: AUTH_MODE.LINK } }),
      /credential verification/i,
    );
    allowLoginFreeUploadLinks = true;
    await assert.doesNotReject(
      resolveExternalUploadAccess({ session: { ...baseSession, authMode: AUTH_MODE.LINK } }),
    );
    allowLoginFreeUploadLinks = false;
    await assert.doesNotReject(
      resolveExternalUploadAccess({ session: { ...baseSession, authMode: AUTH_MODE.CREDENTIALS } }),
    );
    activeLink = null;
    await assert.rejects(
      resolveExternalUploadAccess({ session: { ...baseSession, authMode: AUTH_MODE.CREDENTIALS } }),
      /no longer active/i,
    );
  } finally {
    externalUploadLinkModel.findOne = originalLinkFindOne;
    userModel.findOne = originalUserFindOne;
    orderModel.findOne = originalOrderFindOne;
  }
});

test("history cursor is stable and limits are bounded", () => {
  const source = { _id: "66c000000000000000000001", createdAt: new Date("2026-09-16T10:00:00.000Z") };
  const decoded = decodeExternalUploadHistoryCursor(encodeExternalUploadHistoryCursor(source));
  assert.equal(decoded.createdAt.toISOString(), source.createdAt.toISOString());
  assert.equal(String(decoded.id), source._id);
  assert.equal(getExternalUploadHistoryLimit(undefined), 20);
  assert.equal(getExternalUploadHistoryLimit("500"), 50);
  assert.throws(() => getExternalUploadHistoryLimit("invalid"));
});

test("link model has active-link uniqueness and history pagination indexes", () => {
  const indexes = externalUploadLinkModel.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => fields.customerId === 1 && fields.orderId === 1
    && options.unique === true && options.partialFilterExpression?.status === "active"));
  assert.ok(indexes.some(([fields]) => fields.customerId === 1 && fields.createdAt === -1 && fields._id === -1));
});

test("admin history endpoint returns a bounded cursor page", async () => {
  const originalFind = externalUploadLinkModel.find;
  const rows = [
    { _id: "66c000000000000000000003", createdAt: new Date("2026-09-16T10:00:03.000Z") },
    { _id: "66c000000000000000000002", createdAt: new Date("2026-09-16T10:00:02.000Z") },
    { _id: "66c000000000000000000001", createdAt: new Date("2026-09-16T10:00:01.000Z") },
  ];
  const query = {
    select() { return this; },
    populate() { return this; },
    sort() { return this; },
    limit() { return this; },
    lean: async () => rows,
  };
  externalUploadLinkModel.find = () => query;
  let payload;
  const res = { json: (value) => { payload = value; }, status() { return this; } };

  try {
    await externalUploadLinkController.list({
      userRole: "admin",
      params: { customerId: "66b000000000000000000001" },
      query: { limit: "2" },
    }, res);
    assert.equal(payload.success, true);
    assert.equal(payload.data.items.length, 2);
    assert.ok(payload.data.nextCursor);
    assert.equal(String(decodeExternalUploadHistoryCursor(payload.data.nextCursor).id), rows[1]._id);
  } finally {
    externalUploadLinkModel.find = originalFind;
  }
});

test("a concurrent regeneration conflict keeps the winner active and repairs history", async () => {
  process.env.NODE_ENV = "production";
  process.env.FRONTEND_URL = "https://portal.example.com";
  const originalMethods = {
    create: externalUploadLinkModel.create,
    findOneAndUpdate: externalUploadLinkModel.findOneAndUpdate,
    deleteOne: externalUploadLinkModel.deleteOne,
    exists: externalUploadLinkModel.exists,
    updateOne: externalUploadLinkModel.updateOne,
    userFindOne: userModel.findOne,
    orderFindOne: orderModel.findOne,
  };
  const queryFor = (value) => ({ select() { return this; }, lean: async () => value });
  const candidate = {
    _id: "candidate-link",
    status: "pending",
    save: async () => { const error = new Error("duplicate"); error.code = 11000; throw error; },
  };
  const updates = [];

  userModel.findOne = () => queryFor({ _id: "customer-1", isActive: true, isGuest: false, deletedAt: null });
  orderModel.findOne = () => queryFor({ _id: "order-1", userId: "customer-1", isWebsiteProject: true, isServicePlan: false });
  externalUploadLinkModel.create = async () => candidate;
  externalUploadLinkModel.findOneAndUpdate = async () => ({ _id: "previous-link" });
  externalUploadLinkModel.deleteOne = async () => ({ deletedCount: 1 });
  externalUploadLinkModel.exists = async () => ({ _id: "winning-link" });
  externalUploadLinkModel.updateOne = async (...args) => { updates.push(args); };

  const res = {
    statusCode: null,
    payload: null,
    set() { return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
  };

  try {
    await externalUploadLinkController.generate({
      userRole: "admin",
      userId: "admin-1",
      params: { customerId: "customer-1" },
      body: { orderId: "order-1", mode: "multiple" },
    }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.success, false);
    assert.equal(updates.length, 1);
    assert.equal(String(updates[0][1].$set.replacedBy), "winning-link");
  } finally {
    externalUploadLinkModel.create = originalMethods.create;
    externalUploadLinkModel.findOneAndUpdate = originalMethods.findOneAndUpdate;
    externalUploadLinkModel.deleteOne = originalMethods.deleteOne;
    externalUploadLinkModel.exists = originalMethods.exists;
    externalUploadLinkModel.updateOne = originalMethods.updateOne;
    userModel.findOne = originalMethods.userFindOne;
    orderModel.findOne = originalMethods.orderFindOne;
  }
});
