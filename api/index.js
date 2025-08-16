// api/index.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const Stripe = require('stripe');
const emailjs = require('@emailjs/nodejs');

const app = express();
const port = process.env.PORT || 3000;

// Env vars richieste
const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  EMAILJS_PUBLIC_KEY,
  EMAILJS_PRIVATE_KEY,
  EMAILJS_SERVICE_ID,
  EMAILJS_TEMPLATE_ID,
  // facoltative: se non impostate, si usa 99 (0,99€)
  PRICE_MINOR_UNIT_CUSTOM = '99',
  PRICE_MINOR_UNIT_TEMPLATE = '99',
} = process.env;

if (!STRIPE_SECRET_KEY) console.warn('ATTENZIONE: STRIPE_SECRET_KEY non impostata.');
if (!STRIPE_WEBHOOK_SECRET) console.warn('ATTENZIONE: STRIPE_WEBHOOK_SECRET non impostata.');
if (!EMAILJS_PUBLIC_KEY || !EMAILJS_PRIVATE_KEY || !EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID) {
  console.warn('ATTENZIONE: Config EmailJS incompleta (PUBLIC/PRIVATE KEY, SERVICE_ID, TEMPLATE_ID).');
}

// Blocca richieste con parentesi quadre (evita path-to-regexp edge cases)
app.use((req, res, next) => {
  if (req.url.includes('[') || req.url.includes(']')) {
    return res.status(404).send('Not found');
  }
  next();
});

// Public path (api/ => root/public)
const publicPath = path.join(__dirname, '..', 'public');

// Body parser: raw per webhook Stripe, JSON per altre richieste
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') {
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

// Statici
app.use(express.static(publicPath));

// Stripe
const stripe = Stripe(STRIPE_SECRET_KEY);

// Crea sessione checkout: salva TUTTO nei metadata (nessun tempOrders)
app.post('/api/stripe/create-session', async (req, res) => {
  try {
    const { email, template, signed, custom } = req.body || {};

    if (!email || !template) {
      return res.status(400).send('Dati mancanti: email o template');
    }

    const unitAmount =
      (custom ? parseInt(PRICE_MINOR_UNIT_CUSTOM, 10) : parseInt(PRICE_MINOR_UNIT_TEMPLATE, 10)) || 99;

    // Il messaggio rimane esattamente quello fornito dall’utente
    const msg = template;

    // Log per debug: verifica che `msg` non contenga più la firma
    console.log('Messaggio inviato a Stripe:', msg);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Fanculo automatico',
              description: 'Invia un messaggio ironico via email!',
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${req.protocol}://${req.get('host')}/success?success=1`,
      cancel_url: `${req.protocol}://${req.get('host')}/cancel`,
      metadata: {
        email,
        msg_template: msg,
        signed: String(!!signed),
        custom: String(!!custom),
      },
    });

    return res.json({ sessionId: session.id });
  } catch (err) {
    console.error('Stripe session error:', err);
    return res.status(500).send('Server error');
  }
});



// Webhook Stripe: legge i metadata e invia la mail via EmailJS
app.post('/api/stripe/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook Error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Recupero diretto dai metadata
    const email = session.metadata?.email;
    const msg = session.metadata?.msg_template;

    console.log('Webhook metadata:', { email, hasMsg: !!msg });

    if (email && msg) {
      try {
        await emailjs.send(
          EMAILJS_SERVICE_ID,
          EMAILJS_TEMPLATE_ID,
          { email, to_name: 'Utente', msg_template: msg },
          { publicKey: EMAILJS_PUBLIC_KEY, privateKey: EMAILJS_PRIVATE_KEY }
        );
        console.log('EmailJS inviata con successo');
      } catch (e) {
        console.error('Errore EmailJS:', e);
      }
    } else {
      console.warn('Metadata incompleti nel webhook:', session.metadata);
    }
  }

  res.json({ received: true });
});

// Pagine statiche
app.get('/success', (req, res) => {
  res.sendFile(path.join(publicPath, 'success.html'));
});
app.get('/cancel', (req, res) => {
  res.sendFile(path.join(publicPath, 'cancel.html'));
});

// Fallback su index.html
app.use((req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Avvio server (Render usa process.env.PORT)
app.listen(port, () => console.log('Server avviato su porta ' + port));
