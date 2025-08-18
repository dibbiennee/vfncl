require('dotenv').config();
const express = require('express');
const path = require('path');
const Stripe = require('stripe');
const emailjs = require('@emailjs/nodejs');
const app = express();
const port = process.env.PORT || 3000;
const helmet = require('helmet');
app.use(helmet());

const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  EMAILJS_PUBLIC_KEY,
  EMAILJS_PRIVATE_KEY,
  EMAILJS_SERVICE_ID,
  EMAILJS_TEMPLATE_ID,
  PRICE_MINOR_UNIT_CUSTOM = '99',
  PRICE_MINOR_UNIT_TEMPLATE = '99',
} = process.env;

if (!STRIPE_SECRET_KEY) console.warn('ATTENZIONE: STRIPE_SECRET_KEY non impostata.');
if (!STRIPE_WEBHOOK_SECRET) console.warn('ATTENZIONE: STRIPE_WEBHOOK_SECRET non impostata.');
if (!EMAILJS_PUBLIC_KEY || !EMAILJS_PRIVATE_KEY || !EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID) {
  console.warn('ATTENZIONE: Config EmailJS incompleta (PUBLIC/PRIVATE KEY, SERVICE_ID, TEMPLATE_ID).');
}

// CORS se serve (facoltativo, disattiva se tutto resta in locale/deploy unico)
// const cors = require('cors');
// app.use(cors());

// Prevenzione errori path
app.use((req, res, next) => {
  if (req.url.includes('[') || req.url.includes(']')) {
    return res.status(404).send('Not found');
  }
  next();
});

const publicPath = path.join(__dirname, '..', 'public');

app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') {
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});
app.use(express.static(publicPath));

const stripe = Stripe(STRIPE_SECRET_KEY);

// CREA SESSIONE STRIPE
app.post('/api/stripe/create-session', async (req, res) => {
  try {
    const { email, template, signed, custom } = req.body || {};
    if (!email || !template) {
      return res.status(400).send('Dati mancanti: email o template');
    }
    const unitAmount =
      (custom ? parseInt(PRICE_MINOR_UNIT_CUSTOM, 10) : parseInt(PRICE_MINOR_UNIT_TEMPLATE, 10)) || 99;
    const msg = template;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Invia un FANCULO',
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

// WEBHOOK STRIPE → Invio email tramite EmailJS DOPO pagamento
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
    // --- Recupera dati dai metadata ---
    const email = session.metadata?.email;
    const msg = session.metadata?.msg_template;
    if (email && msg) {
      try {
        await emailjs.send(
          EMAILJS_SERVICE_ID,
          EMAILJS_TEMPLATE_ID,
          {
            email,               // va mappato su {{email}} o simile nel template EmailJS
            msg_template: msg,   // va mappato su {{msg_template}} o simile in EmailJS
            to_name: "Utente",   // opzionale: puoi personalizzare variabili del template EmailJS
          },
          {
            publicKey: EMAILJS_PUBLIC_KEY,
            privateKey: EMAILJS_PRIVATE_KEY,
          }
        );
        console.log('Email inviata tramite EmailJS!');
      } catch (e) {
        console.error('Errore EmailJS:', e);
      }
    }
  }
  res.json({ received: true });
});

// Static files e fallback
app.get('/success', (req, res) => {
  res.sendFile(path.join(publicPath, 'success.html'));
});
app.get('/cancel', (req, res) => {
  res.sendFile(path.join(publicPath, 'cancel.html'));
});
app.use((req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.listen(port, () => console.log('Server avviato su porta ' + port));
