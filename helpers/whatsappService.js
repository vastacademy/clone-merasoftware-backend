import fetch from 'node-fetch';

const WHATSAPP_API_URL = 'http://35.208.75.95:3000/send';

const messageQueue = [];
let isProcessing = false;
const DELAY_MS = 10000; // 10 second delay between messages

async function sendWhatsAppMessageDirect(number, message) {
    try {
        const response = await fetch(WHATSAPP_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ number, message })
        });

        const data = await response.json();

         if (!data || data.status !== 'success') {
            if (data.status === 'not_logged_in') {
                return { status: 'not_logged_in' };
            }
            console.error('WhatsApp Error:', data);
        }
    } catch (err) {
        console.error('Failed to send WhatsApp message:', err.message);
    }
}

function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;
    isProcessing = true;

    const { number, message } = messageQueue.shift();

    sendWhatsAppMessageDirect(number, message).finally(() => {
        setTimeout(() => {
            isProcessing = false;
            processQueue(); // Process next message
        }, DELAY_MS);
    });
}

function sendWhatsAppMessage(number, message) {
    messageQueue.push({ number, message });
    processQueue();
}

export { sendWhatsAppMessage };