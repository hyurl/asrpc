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