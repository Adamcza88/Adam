const Edition = artifacts.require("Edition");

contract("Edition", (accounts) => {
    const [owner, user1, user2] = accounts;
    let edition;

    beforeEach(async () => {
        edition = await Edition.new();
        await edition.setURI("https://example.com/token/{id}.json");
    });

    it("should set URI correctly", async () => {
        const newURI = "https://example.com/token2/{id}.json";
        await edition.setURI(newURI);
        const uri = await edition.uri(0);
        assert.equal(uri, newURI);
    });

    it("should mint tokens correctly", async () => {
        const id = 1;
        const amount = 10;
        const data = "0x00";
        await edition.mint(user1, id, amount, data);
        const balance = await edition.balanceOf(user1, id);
        assert.equal(balance.words[0], amount);
    });

    it("should mint batch of tokens correctly", async () => {
        const ids = [1, 2, 3];
        const amounts = [10, 20, 30];
        const data = "0x00";
        await edition.mintBatch(user1, ids, amounts, data);
        const balances = await edition.balanceOfBatch([user1, user1, user1], ids);
        assert.equal(balances[0].words[0], amounts[0])
    });

    it("should pause and unpause the contract correctly", async () => {
        await edition.pause({ from: owner });
        const isPaused = await edition.paused();
        assert.equal(isPaused, true)

        await edition.unpause({ from: owner });
        const isUnpaused = await edition.paused();
        assert.equal(isUnpaused, false)
    });
});
