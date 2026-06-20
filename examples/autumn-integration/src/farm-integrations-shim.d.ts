declare module "@farmjs/integrations" {
  export { autumn, betterAuth } from "../../../packages/farm-integrations/src/index";
  export type {
    AutumnBillingCurrentChargesResult,
    AutumnBillingInvoice,
    AutumnBillingInvoicesResult,
    AutumnBillingMeterUsageResult,
    AutumnBillingOwner,
    AutumnBillingPlan,
    AutumnBillingProduct,
    AutumnBillingStatusResult,
    AutumnBillingUsageProperties,
    AutumnBillingUsageResult,
    AutumnCatalogMeterPrice,
    AutumnCatalogProduct,
    AutumnWebhookEvent,
  } from "../../../packages/farm-integrations/src/index";
}
