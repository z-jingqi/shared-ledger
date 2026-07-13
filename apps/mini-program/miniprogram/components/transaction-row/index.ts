interface RowProperties {
  item: LedgerTransaction;
}

Component({
  properties: {
    item: { type: Object, value: {} as LedgerTransaction },
  },
  methods: {
    onTap() {
      this.triggerEvent("rowtap", { id: this.properties.item.id });
    },
  },
});
