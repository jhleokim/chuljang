export function fileBucket(namespace) {
  const object=key=>{if(!/^receipts\/[a-f0-9-]{36}$/.test(key))throw new Error('Invalid key');return namespace.getByName(key);};
  return {
    put: (key,value) => object(key).put(key,new Response(value).body),
    get: async key => {const response=await object(key).get(key);return response.status===404?null:{body:response.body};},
    delete: key => object(key).remove(),
  };
}
