Component({
  properties: {
    item: { type: Object, value: {} },
  },
  methods: {
    onTap() {
      this.triggerEvent("rowtap", { id: this.properties.item.id });
    },
  },
});
