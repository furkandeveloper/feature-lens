import { PaymentService } from './payment.service.js';

export function registerPaymentRoutes(router, deps) {
  const service = new PaymentService(deps);

  router.post('/orders/:orderId/pay', async (req, res) => {
    const result = await service.payOrder(req.params.orderId, req.body.cardToken);
    res.status(result.ok ? 200 : 402).json(result);
  });
}
