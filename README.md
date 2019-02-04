# AS-RPC

**A tool to make your class as an RPC service.**

## Idea

*AS* first means English word *as*, that this package will make your class as an
RPC service, And secondly, it also means *as-is*, that no matter how you use the
instance of the class, the usage (syntax) is the same on the server and the 
client. You don't have to change any API of the class, this package is meant to 
wrap your ordinary classes RPC-like.

## Example

```javascript
// SimpleCalculator.js
// for convenience, all remote methods should be async
class SimpleCalculator {
    async sum(...args) {
        console.log(args.join(" + "));
        return args.reduce((a, b) => a + b);
    }

    async sub(...args) {
        console.log(args.join(" - "));
        return args.reduce((a, b) => a - b);
    }

    async multiply(...args) {
        console.log(args.join(" * "));
        return args.reduce((a, b) => a * b);
    }

    async div(...args) {
        console.log(args.join(" / "));
        return args.reduce((a, b) => a / b);
    }
}

exports.SimpleCalculator = SimpleCalculator;
```

```javascript
// server.js
const { createInstance } = require("asrpc");
const { SimpleCalculator } = require("./SimpleCalculator");

var ins = createInstance(2018); // bind port 2018

ins.register(SimpleCalculator); // register service

(async () => {
    await ins.start(); // start service instance
});
```

```javascript
// client.js
const { createInstance } = require("asrpc");
const { SimpleCalculator } = require("./SimpleCalculator");

var ins = createInstance(2018); // also bind port 2018

(async () => {
    var calc = await ins.connect(SimpleCalculator); // connect service
    console.log(await calc.sum(1, 2, 3, 4, 5)); // => 15
    console.log(await calc.sub(15, 5, 4, 3, 2)); // => 1
    console.log(await calc.multiply(1, 2, 3, 4, 5)); // => 120
    console.log(await calc.div(120, 5, 4, 3, 2)); // => 1
});
```

First run `server.js` then run `client.js`.

`server.js` will output:

```
1 + 2 + 3 + 4 + 5
15 - 5 - 4 - 3 - 2
1 * 2 * 3 * 4 * 5
120 / 5 / 4 / 3 / 2
```

and `client.js` will output:

```
15
1
120
1
```

## API

### `createInstance`

This is the only useful function in JavaScript that exposed from this package, 
other objects and interfaces are for TypeScript programming.

**signatures:**

- `createInstance(path: string): ServiceInstance`
- `createInstance(port: number, host?: string): ServiceInstance`
- `createInstance(options: ServiceOptions): ServiceInstance`

Creates a `ServiceInstance` according to the given arguments.

If `path` is provided, the instance binds to a UNIX domain socket or 
**named pipe** on Windows, and communicate via IPC channels. This is very useful
and efficient when the client and server are both run in the same machine. BUT 
must be aware that Windows named pipe has no support in cluster mode.

If `port` is provided, the instance binds to an network port, and communicate 
through network card. This is mainly used when the server and client are run in 
different machines, or in cluster on Windows. If the server and client are in 
different machines (even under different domain), the `host` option must be 
provided (on the client side, optional on the server side).

If `options` is provided, it is an object that contains `path`, `port`, `host` 
and `timeout` (all optional), the first three are corresponding to the 
individual options talked above, while `timeout` is a number in milliseconds and
the default value is `5000`.

### `ServiceInstance`

A type that represents a service instance shipped on the server. This is a class 
exposed in JavaScript as well, but not recommended in use, it should only for 
typing usage, since function `createInstance()` provides a more suitable 
interface.

#### `ServiceInstance.prototype.register<T>(target: ServiceClass<T>): void`

Registers an ordinary JavaScript class (either in ES6 and ES5) as an RPC service.
This method doesn't do any other job, just make a reference in the internal map 
with a unique-supposed string id generated according to the class definition 
itself.

By default, this module will try to get a unique ID according to the class 
definition itself, however, you could always set a static property `id` of the
class to use a specified ID instead.

```typescript
class SimpleCalculator {
    static id = "simple-calculator";
    // ...
}
```

*This method should only be called on the server side.*

#### `ServiceInstance.prototype.deregister<T>(target: ServiceClass<T>): void`

De-registers the target class bound by `register()`. Once a class is 
de-registered, it can no longer be connected on the client.

*This method should only be called on the server side.*

#### `ServiceInstance.prototype.start(): Promise<void>`

Starts the service server, listening for connections and requests from a client.

*This method can only be called on the server side.*

#### `ServiceInstance.prototype.close(): Promise<void>`

Closes the service server shipped by the current instance. Once the server is 
closed, no more connections and requests should be delivered.

*This method can only be called on the server side.*

#### `ServiceInstance.prototype.connect<T>(target: ServiceClass<T>, ...args: any[]): Promise<T>`

Connects to the service server and returns a new instance of `target`. If `args`
is provided, it is any number of arguments passed to the class constructor. When 
the service is connected, they will be assigned to the instance on the server as
well.

By default, this module will try to get the instance by using keyword `new`,
however, if the `target` provides a static method `getInstance()` (without 
parameters), it will try to call this method to get the instance instead.

```typescript
class SimpleCalculator {
    static getInstance() {
        return new SimpleCalculator();
    }
}
```

*This method can only be called on the client side.*

#### `ServiceInstance.prototype.disconnect(service: any): Promise<void>`

Disconnects the given service returned by `connect()`. Once a service is 
disconnected, no more operations should be called on it.

*This method can only be called on the client side.*

#### `ServiceInstance.prototype.onError(handler: (err: Error) => void): void`

Binds an error handler to be invoked whenever an error occurred in asynchronous 
operations which can't be caught during run-time.

## Efficiency

Once the `start()` method is called, a Domain/TCP socket will be created, and 
the first time `connect()` is called, a socket client will be created, and ONLY 
one client will be created in one `ServiceInstance`, every connected service 
shares this client. There is no need and no reason to separate client for each 
service. The requests and responses are distinguished by the service itself, you 
don't have to worry connecting too much services might causing creating multiple 
connections, it will not.

The socket channel sends minimal data (numbers starts from `0`) to explain which
service and method is being called, along with user input data, to provide the 
best performance of data transmission.

## Supported Data Types

Since the operation will be delivered to the server rather than calling locally,
so not all JavaScript types are supported through socket communication, due to 
efficiency and compatibility considerations, this module (since version 2.0) 
uses **JSON** to transfer data in socket, so only the types that JSON supports 
will be transmit through the channel.

## Error Handle

If any error occurred on the server side in a service, the error will be send 
back to the client, and it will be just like the error that occurred on the 
client side, you will not see any difference between them, so just focus on 
your design as usual.

But not all errors can't be caught, like an error occurred inside the socket 
itself, these errors can be handled via `onError()` method.

## Warning

Although this package will try to bring the most familiar experience for your 
code to use as RPC service as used ordinarily. BUT, due to the program runs in 
different processes, so are instances. The reason why you can access methods on 
the client but fetch results from the server is that this package wrapped your 
client service in a `Proxy` constructor, and when you call a method, the 
operation will be delivered to the server and call the version on the server 
instead. But only the methods can do this, that means if you try to access other 
properties, you will get the value in the local service, instead of the one on 
the server.

So it's recommended for properties, except constants or `readonly` properties, 
should be set private or protected, since they should only be accessed inside 
the class itself. There is not point you will access those properties on the 
server side, since the instance is handled by `ServiceInstance`, not by human. 
And on the client side, you will never get the real property value outside the 
class, also no point to set them public. If you really need to get the 
properties, define a method to do so.

```javascript
class TestService {
    constructor() {
        this.name = "TestService"; // this is a readonly property
        this.text = "Hello, World!";
    }

    async set(prop, value) {
        this[prop] = value;
    }

    async get(prop) {
        return this[prop];
    }
}

// on the client side
(async () => {
    var ins = createInstance(2018);
    var srv = await ins.connect(TestService);

    console.log(srv.name); // TestService
    console.log(await srv.get("text")); // Hello, World!
    await srv.set("text", "Hi, there!");
    console.log(srv.text); // still: Hello, World!
    console.log(await srv.get("text")); // Hi, there!
})();
```