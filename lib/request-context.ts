export type BrainRequestContext = {
  tenantId: string;
  principalId: string;
};

export class RequestContextError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export function resolveBrainRequestContext(request: Request, bodyPrincipalId?: string): BrainRequestContext {
  const expectedTenantId = process.env.COMPANY_BRAIN_TENANT_ID ?? "tenant_demo";
  const tenantId = request.headers.get("x-tenant-id") ?? expectedTenantId;

  if (tenantId !== expectedTenantId) {
    throw new RequestContextError(`Tenant ${tenantId} is not allowed in this deployment.`);
  }

  return {
    tenantId,
    principalId: request.headers.get("x-principal-id") ?? bodyPrincipalId ?? "usr_admin"
  };
}

export function statusForBrainError(error: unknown) {
  if (error instanceof RequestContextError) {
    return error.status;
  }

  if (error instanceof Error && /(principal|not allowed|cannot review|reviewer|forbidden|unauthorized)/i.test(error.message)) {
    return 403;
  }

  return 400;
}

export function messageForBrainError(error: unknown) {
  return error instanceof Error ? error.message : "Brain request failed.";
}
