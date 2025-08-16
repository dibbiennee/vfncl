// index.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const Stripe = require('stripe');
const emailjs = require('@emailjs/nodejs');

const app = express();
const port = process.env.PORT || 3000;

// ---------------------------
// Config da variabili d'ambiente (metti queste nel tuo .env)
// ---------------------------
// STRIPE_SECRET_KEY=sk_test_...
// STRIPE_WEBHOOK_SECRET=whsec_...
// EMAILJS_PUBLIC_KEY=...
// EMAILJS_PRIVATE_KEY=...
// EMAILJS_SERVICE_ID=service_...
// EMAILJS_TEMPLATE_ID=template_...
// PRICE_MINOR_UNIT_CUSTOM=99        // in centesimi (es: 99 = €0,99) -> adatta al tuo caso
// PRICE_MINOR_UNIT_TEMPLATE=99       // in centesimi (es: 99 = €0,99)
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

if (!STRIPE_SECRET_KEY) {
  console.warn('ATTENZIONE: STRIPE_SECRET_KEY non impostata.');
}
if (!STRIPE_WEBHOOK_SECRET) {
  console.warn('ATTENZIONE: STRIPE_WEBHOOK_SECRET non impostata.');
}

// 0️⃣ Blocca richieste contenenti parentesi quadre
app.use((req, res, next) => {
  if (req.url.includes('[') || req.url.includes(']')) {
    return res.status(404).send('Not found');
  }
  next();
});

// Percorso alla cartella public (risale di una directory rispetto a api/)
const publicPath = path.join(__dirname, '..', 'public');

// 1️⃣ Body parser: raw per webhook, JSON per tutte le altre richieste
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') {
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

// 2️⃣ Servi file statici
app.use(express.static(publicPath));

// 3️⃣ Memoria temporanea per gli ordini (in produzione usa un DB)
const tempOrders = {};

// 4️⃣ Endpoint per creare sessione Stripe
const stripe = Stripe(STRIPE_SECRET_KEY);

app.post('/api/stripe/create-session', async (req, res) => {
  try {
    const { email, template, signed, custom } = req.body || {};

    // Validazioni minime
    if (!email || !template) {
      return res.status(400).send('Dati mancanti: email o template');
    }

    const order_id = Math.random().toString(36).slice(2);
    tempOrders[order_id] = { email, template, signed: !!signed, custom: !!custom };

    const unitAmount = custom ? parseInt(PRICE_MINOR_UNIT_CUSTOM, 10) : parseInt(PRICE_MINOR_UNIT_TEMPLATE, 10);

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
            unit_amount: unitAmount, // in centesimi
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      // Aggiungi ?success=1 per aprire il popup "Grazie" al ritorno
      success_url: `${req.protocol}://${req.get('host')}/success?success=1`,
      cancel_url: `${req.protocol}://${req.get('host')}/cancel`,
      metadata: { order_id },
    });

    // Modalità 1: ritorna URL diretto (consigliato per il tuo frontend)
    // return res.json({ url: session.url });

    // Modalità 2: ritorna sessionId (coerente col tuo codice originale)
    return res.json({ sessionId: session.id });
  } catch (err) {
    console.error('Stripe session error:', err);
    return res.status(500).send('Server error');
  }
});

// 5️⃣ Webhook Stripe
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
    try {
      const orderData = tempOrders[session.metadata.order_id];
      if (orderData) {
        let msg = orderData.template;
        if (orderData.signed) {
          msg += '\n\n-- Inviato con simpatia da Mavattenaffanculo.site';
        }

        // Invia email via EmailJS
        try {
          await emailjs.send(
            EMAILJS_SERVICE_ID,
            EMAILJS_TEMPLATE_ID,
            { email: orderData.email, to_name: 'Utente', msg_template: msg },
            { publicKey: EMAILJS_PUBLIC_KEY, privateKey: EMAILJS_PRIVATE_KEY }
          );
        } catch (e) {
          console.error('Errore EmailJS:', e);
        }

        // Cleanup in memoria (opzionale)
        delete tempOrders[session.metadata.order_id];
      } else {
        console.warn('Order non trovato per order_id:', session.metadata.order_id);
      }
    } catch (e) {
      console.error('Errore gestione checkout.session.completed:', e);
    }
  }

  res.json({ received: true });
});

// 6️⃣ Pagine di conferma/cancellazione statiche
app.get('/success', (req, res) => {
  res.sendFile(path.join(publicPath, 'success.html'));
});
app.get('/cancel', (req, res) => {
  res.sendFile(path.join(publicPath, 'cancel.html'));
});

// 7️⃣ Fallback generico (no path-to-regexp)
app.use((req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// 8️⃣ Avvia server
app.listen(port, () => console.log('Server avviato su porta ' + port));

