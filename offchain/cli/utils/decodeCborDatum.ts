import { toText } from "@lucid-evolution/lucid";

const cborDatum = {
    constructor: 0,
    fields: [
        {
            "6e616d65": {
                "bytes": "5553444d",
            },
            "6465736372697074696f6e": {
                "bytes":
                    "466961742d6261636b656420737461626c65636f696e206e617469766520746f207468652043617264616e6f20626c6f636b636861696e",
            },
            "7469636b6572": {
                "bytes": "5553444d",
            },
            "75726c": {
                "bytes": "68747470733a2f2f6d6568656e2e696f2f",
            },
            "6c6f676f": {
                "bytes":
                    "697066733a2f2f516d5078596570454648747533474252754b3652684c35774b72536d7867596a6245753843416446773444676871",
            },
            "646563696d616c73": {
                "int": "6",
            },
            "6c6567616c": {
                "bytes": "68747470733a2f2f6d6568656e2e696f2f6d6568656e5f7465726d735f6f665f736572766963652f",
            },
        },
        {
            "int": "1",
        },
    ],
};

for (const [idx, field] of Object.entries(cborDatum.fields)) {
    if (idx === "0") {
        for (const [key, value] of Object.entries(field)) {
            const utfKey = toText(key);
            const utfValue = value.bytes ? toText(value.bytes) : value.int;
            console.log(`${utfKey}: ${utfValue}`);
            console.log();
        }
    }
}
