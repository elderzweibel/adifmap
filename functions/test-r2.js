// /functions/test-r2.js
export async function onRequest(context) {
  // Use the variable name you set in the binding
  const bucket = context.env.k1iad-storage; 

  try {
    const object = await bucket.get('test.txt');

    if (object) {
      return new Response(`Binding is effective. Content: ${await object.text()}`);
    } else {
      return new Response('Binding is effective, but file not found in bucket.', { status: 404 });
    }
  } catch (error) {
    // If the binding failed, the error message might reveal it
    return new Response(`Binding failed to access R2: ${error.message}`, { status: 500 });
  }
}