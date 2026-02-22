class Navigation {
  private rawModalStack: boolean[] = [];

  get isRawModalVisible() {
    return this.rawModalStack.length > 0;
  }

  setIsRawModalVisible(visible: boolean) {
    if (visible) {
      this.rawModalStack.push(true);
    } else {
      this.rawModalStack.pop();
    }
  }
}

const navigation = new Navigation();

export default navigation;
