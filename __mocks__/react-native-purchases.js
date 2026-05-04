// Stub for the RevenueCat SDK. Tests inject `runFlow` so the real
// SDK is never exercised.
const stub = () => Promise.reject(new Error("react-native-purchases is mocked in tests"));

const Purchases = {
  configure: stub,
  isConfigured: stub,
  getOfferings: stub,
  purchasePackage: stub,
  restorePurchases: stub,
  getCustomerInfo: stub,
  logIn: stub,
  logOut: stub,
  setLogLevel: () => {},
};

module.exports = Purchases;
module.exports.default = Purchases;
module.exports.LOG_LEVEL = { DEBUG: "DEBUG" };
module.exports.PURCHASES_ERROR_CODE = {};
