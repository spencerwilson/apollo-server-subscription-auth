const { ApolloServer, gql, ForbiddenError } = require("apollo-server");

// A schema is a collection of type definitions (hence "typeDefs")
// that together define the "shape" of queries that are executed against
// your data.
const typeDefs = gql`
  type Query {
    _: String
  }

  type Subscription {
    "Squares of your favorite integers!"
    squares: Int!

    "Demonstrate failing inside 'resolve'."
    failDemo: Boolean
  }
`;

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

// Returns an AsyncIterator<number>.
async function* createIntegers() {
  let n = 0;
  while (true) {
    await delay(1000);
    yield n;
    n += 1;
  }
}

const resolvers = {
  Query: {
    _: () => "placeholder",
  },
  Subscription: {
    squares: {
      // Create the Source Stream for `squares`: an AsyncIterator<number>.
      // Called once per subscription instance as part of "executing the subscription".
      // In this resolver, consider throwing/rejecting if the either
      //    - the client is not authorized to access this subscription (may be a
      //      function of args in addition to context, e.g.)
      //    - the source stream can't be prepared
      // As each value yielded from the returned AsyncIterator should map to an event
      // sent to the client, perform any filtering here as well.
      //
      // Note: Nothing happens if `subscribe` throws or rejections. This is
      //
      // Note: the first argument is unused! (It's not the server's `rootValue`?)
      // The `context` passed here and to `resolve` is the same object, computed
      // from the `context` Server option after `onConnect`.
      subscribe: async (_, args, context, info) => {
        console.log("[subscribe] rootValue:", _);
        process.stdout.write("authenticating... ");
        await delay(2000);
        console.log("done; context:", context);
        if (context.user === "rando") {
          console.error("rando blocked");
          throw new ForbiddenError("rando not authorized");
        }
        console.log("subscribe returning");
        return createIntegers();
      },

      // Map events (values) from the Source Stream--the AsyncIterator that `subscribe`
      // prepared--to events on the Result Stream. Called once per value yielded from
      // the Source Stream. The `rootValue` is the value from the Source Stream.
      resolve: (rootValue, args, context, info) => {
        console.log("[resolve] rootValue:", rootValue, "context:", context);
        return rootValue ** 2;
      },
    },

    failDemo: {
      // Since the above just has the effect of sending a single `{}` response event,
      // here's an approach that's no worse, but maybe slightly better?
      subscribe: async (_, args, context, info) => {
        // Assume for the demonstration that the subscription should fail.
        console.log(
          "[subscribe for failDemo] creating a one-shot AsyncIterator"
        );
        async function* error() {
          yield { success: false, reason: new Exception("not authorized") };
        }
        return error();
      },

      // Map events (values) from the Source Stream--the AsyncIterator that `subscribe`
      // prepared--to events on the Result Stream. Called once per value yielded from
      // the Source Stream. The `rootValue` is the value from the Source Stream.
      resolve: (rootValue, args, context, info) => {
        console.log("[resolve] rootValue:", rootValue, "context:", context);
        if (!rootValue.success) return Promise.reject(rootValue.reason);
      },
    },
  },
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
  // ? Not given to subscription root fields.
  rootValue: "blah",
  // context is resolved once per operation, regardless of type. For subscriptions,
  // it's resolved after `onConnect` but before calling `subscribe`. The context
  // resolved here is the same object given to all subsequent calls of `subscribe` and
  // `resolve` for a given subscription instance.
  context: (expressContext) => {
    console.log(
      "context initializer called; expressContext:",
      Object.keys(expressContext)
    );

    console.log(expressContext);

    if (expressContext.connection) {
      // Operation is via WebSocket.
      return { user: expressContext.connection.context.user };
    }

    // Operation is via HTTP request.
    return { user: "http" };
  },
  subscriptions: {
    // The value returned from this function is `connection.context` on the
    // ExpressContext passed to the context resolver above.
    onConnect: (connectionParams, webSocket, connectionContext) => {
      // Uncomment this to see the connection error and end immediately, with no
      // data sent back.
      // throw new Error('foo');

      // Uncomment this to see the requested subscription root field's `subscribe`
      // STILL be called(??!!). Fortunatelly, from the client's perspective, it's
      // still an immediate error.
      // return false;

      // ! connectionParams.headers are a plain object. Be sure to be case-insensitive
      // ! when looking for a given header! Below, we can only detect "Authorization"
      // ! exactly.
      return { user: connectionParams.headers["Authorization"] };
    },
  },

  plugins: [
    {
      serverWillStart() {
        console.log("Server starting up!");
      },
      // ! NONE of these get called at any point during subscriptions.
      requestDidStart() {
        return {
          willResolveField(...args) {
            console.log("RESOLVING FIELD");
            console.log(...args);
          },
          didEncounterErrors(...args) {
            console.log("DID ERROR");
            console.log(...args);
          },
          willSendResponse(...args) {
            console.log("willSendResponse");
            console.log(...args);
          },
        };
      },
    },
  ],
});
server.listen().then(({ url }) => {
  console.log(`Server ready at ${url}`);
});
