const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.EXTERNAL_UPLOAD_TOKEN_SECRET = "phase-3-test-secret-with-more-than-32-characters";
process.env.NODE_ENV = "test";
process.env.RESEND_API_KEY = "re_external_upload_test_only";

const externalUploadLinkModel = require("../models/externalUploadLinkModel");
const userModel = require("../models/userModel");
const orderModel = require("../models/orderProductModel");
const externalUploadController = require("../controller/user/externalUploadController");
const { UPLOAD_KIND } = require("../helpers/uploadType");
const { createExternalUploadToken } = require("../helpers/externalUploadToken");
const { readExternalUploadSession, COOKIE_NAME, SESSION_STAGE, AUTH_MODE } = require("../helpers/externalUploadSession");
const upload = require("../middleware/uploadFiles");
const { MAX_SERVICE_FILES_PER_UPLOAD, MAX_UPLOAD_FILE_SIZE_BYTES } = require("../config/uploadLimits");

test("multipart policy remains shared and bounded", () => {
  assert.equal(upload.limits.files, MAX_SERVICE_FILES_PER_UPLOAD);
  assert.equal(upload.limits.fileSize, MAX_UPLOAD_FILE_SIZE_BYTES);
});

test("link exchange chooses challenge or restricted access from the live client consent", async () => {
  const originalLinkFindOne = externalUploadLinkModel.findOne;
  const originalUserFindOne = userModel.findOne;
  const originalOrderFindOne = orderModel.findOne;
  let loginFree = false;
  const queryFor = (value) => ({ select() { return this; }, lean: async () => value });
  externalUploadLinkModel.findOne = () => ({ lean: async () => ({ _id: "link-1", customerId: "customer-1", orderId: "order-1", status: "active" }) });
  userModel.findOne = () => queryFor({ _id: "customer-1", isActive: true, isGuest: false, deletedAt: null, allowLoginFreeUploadLinks: loginFree });
  orderModel.findOne = () => queryFor({ _id: "order-1", userId: "customer-1", isWebsiteProject: true, isServicePlan: false });

  const runExchange = async () => {
    let cookie;
    const res = {
      statusCode: 200,
      set() { return this; },
      cookie(name, value) { cookie = { name, value }; return this; },
      status(value) { this.statusCode = value; return this; },
      json(value) { this.payload = value; return this; },
    };
    await externalUploadController.exchange({ body: { token: createExternalUploadToken() } }, res);
    return { res, session: readExternalUploadSession({ cookies: { [COOKIE_NAME]: cookie.value } }) };
  };

  try {
    const protectedResult = await runExchange();
    assert.equal(protectedResult.res.payload.data.requiresCredentials, true);
    assert.equal(protectedResult.session.stage, SESSION_STAGE.CHALLENGE);
    assert.equal(protectedResult.session.authMode, null);

    loginFree = true;
    const loginFreeResult = await runExchange();
    assert.equal(loginFreeResult.res.payload.data.requiresCredentials, false);
    assert.equal(loginFreeResult.session.stage, SESSION_STAGE.ACCESS);
    assert.equal(loginFreeResult.session.authMode, AUTH_MODE.LINK);
  } finally {
    externalUploadLinkModel.findOne = originalLinkFindOne;
    userModel.findOne = originalUserFindOne;
    orderModel.findOne = originalOrderFindOne;
  }
});

test("state-changing public endpoints reject an unknown browser origin", () => {
  let nextCalled = false;
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.payload = value; return this; } };
  externalUploadController.requireAllowedOrigin({ get: () => "https://attacker.example" }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("public adapter overwrites all browser-supplied ownership identifiers", () => {
  const projectRequest = {
    body: { planId: "attacker-plan", serviceOrderId: "attacker-service", instructions: "[]" },
    externalUpload: {
      customer: { _id: "trusted-customer" },
      order: { _id: "trusted-project" },
      kind: UPLOAD_KIND.PROJECT,
    },
  };
  externalUploadController.applyExternalUploadIdentity(projectRequest);
  assert.equal(projectRequest.userId, "trusted-customer");
  assert.equal(projectRequest.body.planId, "trusted-project");
  assert.equal("serviceOrderId" in projectRequest.body, false);

  const serviceRequest = {
    body: { planId: "attacker-plan", serviceOrderId: "attacker-service" },
    externalUpload: {
      customer: { _id: "trusted-customer" },
      order: { _id: "trusted-service" },
      kind: UPLOAD_KIND.SERVICE,
    },
  };
  externalUploadController.applyExternalUploadIdentity(serviceRequest);
  assert.equal(serviceRequest.body.planId, "trusted-service");
  assert.equal(serviceRequest.body.serviceOrderId, "trusted-service");
});

test("single-use reservation is an atomic compare-and-set", async () => {
  const originalFindOneAndUpdate = externalUploadLinkModel.findOneAndUpdate;
  let capturedFilter;
  externalUploadLinkModel.findOneAndUpdate = (filter) => {
    capturedFilter = filter;
    return { select: async () => ({ _id: "link-1" }) };
  };
  let nextCalled = false;
  const req = { externalUpload: { link: { _id: "link-1", mode: "single" } } };
  const res = { status() { return this; }, json() { return this; } };
  try {
    await externalUploadController.reserveSingleUse(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.ok(req.externalUpload.reservationId);
    assert.equal(capturedFilter.status, "active");
    assert.ok(Array.isArray(capturedFilter.$or));
  } finally {
    externalUploadLinkModel.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("external submit middleware is ordered before multipart buffering", () => {
  const routeSource = fs.readFileSync(path.join(__dirname, "../routes/index.js"), "utf8");
  const routeStart = routeSource.indexOf('"/external-upload/submit"');
  const routeEnd = routeSource.indexOf(');', routeStart);
  const route = routeSource.slice(routeStart, routeEnd);
  assert.ok(route.indexOf("requireAllowedOrigin") < route.indexOf("requireAccess"));
  assert.ok(route.indexOf("requireAccess") < route.indexOf("reserveSingleUse"));
  assert.ok(route.indexOf("reserveSingleUse") < route.indexOf("parseFiles"));
  assert.ok(route.indexOf("parseFiles") < route.indexOf("externalUploadController.submit"));
});

test("existing authenticated upload route still uses auth before the shared multipart policy", () => {
  const routeSource = fs.readFileSync(path.join(__dirname, "../routes/index.js"), "utf8");
  assert.match(routeSource, /router\.post\("\/user-request-update", authToken, upload\.any\(\), submitUpdateRequest\)/);
});
