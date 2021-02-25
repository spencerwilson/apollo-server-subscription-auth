# Subscriptions in Apollo Server

In [#1248](https://github.com/apollographql/apollo-server/issues/1248), discussion [#4690](https://github.com/apollographql/apollo-server/discussions/4690), [#90](https://github.com/apollographql/graphql-subscriptions/issues/90) in graphql-subscriptions, and elsewhere, people have been unsure of how to do auth-related things on subscriptions with Apollo Server:

1. When should authentication be performed? In `onConnect` or in the server's `context` resolver function?
2. When + how should authorization policies be evaluated on a subscription? E.g., imagine a client requests to subscribe to `newMessages` on a private chat that they don't belong to.

This repo has some code to prototype different approaches. It demonstrates:

* The server's `context` resolver is called exactly once for each request, including subscriptions.

* `subscribe` and `resolve` on a subscription root field's definition are both "resolvers" in the GraphQL spec:

  * `subscribe` resolves the Source Stream (an `AsyncIteratior<T>` in JavaScript's GraphQL implementation)
  * `resolve` resolves an event on the Source Stream—a `T`—to a value for the subscription root field.

  As both are resolvers, they take the [classic four arguments](https://www.apollographql.com/docs/apollo-server/data/resolvers/#resolver-arguments): `parent`, `args`, `context`, `info`.

* `subscribe`'s first argument is always `undefined`, regardless of the server's configured `rootValue`.
  * Seems like a bug?
* `resolve`'s first argument is the source event, of type `T`, from the Source Stream.
* Both can return promises.
* The `context` object is resolved after `onConnect`, but before calling resolvers. The same object is passed to both resolvers, for the life of the subscription request.
* If `subscribe` rejects, an empty `{}` is given to the client and the subscription stays open.
* If `resolve` rejects, an error is given to the client and the subscription closes.
* If `onConnect` throws, the client sees an immediate error, no data.
* If `onConnect` returns `false`, the client sees an immediate error and no data **but the `subscribe` resolver still gets called(!)**
  * This could be a DoS attack vector: spam a GraphQL API with unauthenticated subscription requests. It'll deny your connections, but still be creating many AsyncIterators that might not be GC-able.
* None of the request lifecycle plugin hooks get called for subscriptions, at all.
  * Seems like a bug, or worth calling out in the docs at least.
* Lastly, just FYI: if you're considering using `withFilter` from [graphql-subscriptions](https://github.com/apollographql/graphql-subscriptions), maybe hold off at least until its open memory leak bug, [#212](https://github.com/apollographql/graphql-subscriptions/issues/212), is fixed. An alternative might be to write your own `filter` that supports taking an `AsyncIterator` as an argument.

## Examples

Tested using [graphqurl](https://github.com/hasura/graphqurl) as the client.

**An authorized person, `alice`, subscribes to a stream of squares of non-negative integers.**

```
gq http://localhost:4000/graphql -H 'Authorization: alice' -q 'subscription { squares }'
Executing query... event received
{
  "data": {
    "squares": 0
  }
}
Waiting... event received
{
  "data": {
    "squares": 1
  }
}
Waiting... event received
{
  "data": {
    "squares": 4
  }
}
Waiting... event received
{
  "data": {
    "squares": 9
  }
}
Waiting... ⣟
^C
```

**An unauthorized person, `rando`, does the same. `subscribe` rejects when it recognizes this.**

```
gq http://localhost:4000/graphql -H 'Authorization: rando' -q 'subscription { squares }'
Executing query... event received
{}
Waiting... ⣟
^C
```

**A demo of a "later" rejection: instead of `subscribe` rejecting, what if just yields a single, error-describing value?**

```
gq http://localhost:4000/graphql -H 'Authorization: rando' -q 'subscription { failDemo }'
Executing query... error
^C
```

